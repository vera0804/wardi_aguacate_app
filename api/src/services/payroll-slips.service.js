const { pool } = require('../db');

const AGUINALDO_MONTHLY_FRACTION = 1 / 12;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function normalizeDate(value, { required = true, field = 'fecha' } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const err = new Error(`${field} debe ser YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return s;
}

function normalizeMoney(value, { field }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${field} debe ser un número mayor o igual a 0.`);
    err.status = 400;
    throw err;
  }
  return round2(n);
}

function isFullCalendarMonth(periodFrom, periodTo) {
  const [y1, m1, d1] = periodFrom.split('-').map(Number);
  const [y2, m2, d2] = periodTo.split('-').map(Number);
  if (y1 !== y2 || m1 !== m2 || d1 !== 1) return false;
  const lastDay = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
  return d2 === lastDay;
}

async function getWorkerForClient({ db, workerId, clientId }) {
  const res = await db.query(
    `SELECT id, worker_type, first_name, last_name_1, last_name_2, client_id, is_active
     FROM workers
     WHERE id = $1 AND client_id = $2`,
    [workerId, clientId]
  );
  const w = res.rows[0];
  if (!w) {
    const err = new Error('Trabajador no encontrado.');
    err.status = 404;
    throw err;
  }
  if (!w.is_active) {
    const err = new Error('El trabajador está inactivo.');
    err.status = 409;
    throw err;
  }
  return w;
}

async function findNominaRuleForDate({ db, clientId, asOfDate }) {
  const res = await db.query(
    `SELECT id,
            employer_ccss_pct_of_gross,
            employer_other_pct_of_gross,
            employee_pct_of_gross,
            valid_from,
            valid_to
     FROM payroll_nomina_contribution_rules
     WHERE client_id = $1
       AND is_active = true
       AND valid_from <= $2::date
       AND (valid_to IS NULL OR valid_to >= $2::date)
     ORDER BY valid_from DESC
     LIMIT 1`,
    [clientId, asOfDate]
  );
  return res.rows[0] || null;
}

async function assertNoPaidPayrollOverlap({ db, clientId, workerId, periodFrom, periodTo }) {
  const res = await db.query(
    `SELECT id, period_from, period_to
     FROM payroll_slips
     WHERE client_id = $1
       AND worker_id = $2
       AND status = 'pagada'
       AND period_from <= $4::date
       AND period_to >= $3::date
     LIMIT 1`,
    [clientId, workerId, periodFrom, periodTo]
  );
  if (res.rows[0]) {
    const err = new Error(
      'Ya existe una planilla pagada que cubre fechas de este periodo. No se puede superponer con una nueva planilla.'
    );
    err.status = 409;
    throw err;
  }
}

async function findCalculadaSlipId({ db, clientId, workerId, periodFrom, periodTo }) {
  const res = await db.query(
    `SELECT id FROM payroll_slips
     WHERE client_id = $1
       AND worker_id = $2
       AND period_from = $3::date
       AND period_to = $4::date
       AND status = 'calculada'
     LIMIT 1`,
    [clientId, workerId, periodFrom, periodTo]
  );
  return res.rows[0]?.id ?? null;
}

async function replaceSlipLotAllocations(db, clientId, slipId, lotAllocations) {
  const slipCheck = await db.query(
    `SELECT 1 FROM payroll_slips WHERE id = $1 AND client_id = $2`,
    [slipId, clientId]
  );
  if (!slipCheck.rows[0]) {
    const err = new Error('Planilla no encontrada.');
    err.status = 404;
    throw err;
  }

  const rows = Array.isArray(lotAllocations) ? lotAllocations : [];
  if (rows.length === 0) {
    await db.query(
      `DELETE FROM payroll_slip_lot_allocations psla
       WHERE psla.payroll_slip_id = $1
         AND EXISTS (
           SELECT 1 FROM payroll_slips ps
           WHERE ps.id = psla.payroll_slip_id AND ps.client_id = $2
         )`,
      [slipId, clientId]
    );
    return;
  }

  const lotIds = [...new Set(rows.map((r) => r.lot_id).filter(Boolean))];
  if (lotIds.length !== rows.length) {
    const err = new Error('Las asignaciones por lote deben tener un lote distinto por fila.');
    err.status = 400;
    throw err;
  }
  for (const row of rows) {
    if (!row.lot_id) {
      const err = new Error('Cada asignación debe incluir un lote válido.');
      err.status = 400;
      throw err;
    }
  }

  const cntRes = await db.query(
    `SELECT COUNT(DISTINCT id)::int AS n
     FROM lots
     WHERE client_id = $1
       AND id = ANY($2::uuid[])`,
    [clientId, lotIds]
  );
  const n = cntRes.rows[0]?.n ?? 0;
  if (n !== lotIds.length) {
    const err = new Error('Uno o más lotes no pertenecen a este cliente o no existen.');
    err.status = 400;
    throw err;
  }

  await db.query(
    `DELETE FROM payroll_slip_lot_allocations psla
     WHERE psla.payroll_slip_id = $1
       AND EXISTS (
         SELECT 1 FROM payroll_slips ps
         WHERE ps.id = psla.payroll_slip_id AND ps.client_id = $2
       )`,
    [slipId, clientId]
  );
  for (const row of rows) {
    await db.query(
      `INSERT INTO payroll_slip_lot_allocations (payroll_slip_id, lot_id, allocation_pct, amount_allocated)
       VALUES ($1, $2, $3, $4)`,
      [slipId, row.lot_id, row.allocation_pct, row.amount_allocated]
    );
  }
}

async function computePayrollSlipDerivedValues({
  db,
  clientId,
  workerId,
  kind,
  pf,
  pt,
  receivesAguinaldo,
  declaresCcss,
  monthlyGross,
}) {
  let grossTotal = 0;
  let employerCcss = 0;
  let employerOther = 0;
  let employeeCcss = 0;
  let employerCcssPctSnap = null;
  let employerOtherPctSnap = null;
  let employeePctSnap = null;
  let nominaRuleId = null;

  if (declaresCcss) {
    const rule = await findNominaRuleForDate({ db, clientId, asOfDate: pf });
    if (!rule) {
      const err = new Error(
        'No hay una regla activa de "Detalles de pagos de nómina" vigente para la fecha de inicio del periodo. Configúrela o desactive "declara CCSS".'
      );
      err.status = 409;
      throw err;
    }
    nominaRuleId = rule.id;
    employerCcssPctSnap = Number(rule.employer_ccss_pct_of_gross);
    employerOtherPctSnap = Number(rule.employer_other_pct_of_gross || 0);
    employeePctSnap = Number(rule.employee_pct_of_gross);
  }

  if (kind === 'fijo') {
    if (monthlyGross === undefined || monthlyGross === null) {
      const err = new Error('Para trabajador fijo debe indicar el salario mensual (monthly_gross).');
      err.status = 400;
      throw err;
    }
    grossTotal = normalizeMoney(monthlyGross, { field: 'monthly_gross' });
    if (declaresCcss) {
      employerCcss = round2((grossTotal * employerCcssPctSnap) / 100);
      employerOther = round2((grossTotal * employerOtherPctSnap) / 100);
      employeeCcss = round2((grossTotal * employeePctSnap) / 100);
    }
  } else {
    grossTotal = round2(await sumLaborGross({ db, clientId, workerId, periodFrom: pf, periodTo: pt }));
    if (declaresCcss) {
      employerCcss = round2((grossTotal * employerCcssPctSnap) / 100);
      employerOther = round2((grossTotal * employerOtherPctSnap) / 100);
      employeeCcss = round2((grossTotal * employeePctSnap) / 100);
    }
  }

  const aguinaldoProvision = receivesAguinaldo ? round2(grossTotal * AGUINALDO_MONTHLY_FRACTION) : 0;
  const totalEmployerLiability = round2(grossTotal + employerCcss + employerOther);

  const lotRows = await aggregateLaborByLot({ db, clientId, workerId, periodFrom: pf, periodTo: pt });
  const lotAllocations = buildLotAllocations(totalEmployerLiability, lotRows);

  return {
    grossTotal,
    employerCcss,
    employerOther,
    employeeCcss,
    aguinaldoProvision,
    totalEmployerLiability,
    employerCcssPctSnap,
    employerOtherPctSnap,
    employeePctSnap,
    nominaRuleId,
    lotAllocations,
  };
}

async function aggregateLaborByLot({ db, clientId, workerId, periodFrom, periodTo }) {
  const res = await db.query(
    `SELECT lot_id, SUM(amt)::numeric(14,2) AS total
     FROM (
       SELECT le.lot_id AS lot_id, le.amount::numeric AS amt
       FROM labor_entries le
       WHERE le.client_id = $1
         AND le.worker_id = $2
         AND le.is_active = true
         AND le.work_date >= $3::date
         AND le.work_date <= $4::date
         AND le.cost_scope = 'lot'
         AND le.lot_id IS NOT NULL
       UNION ALL
       SELECT lea.lot_id, COALESCE(lea.amount_allocated, 0)::numeric
       FROM labor_entries le
       JOIN labor_entry_allocations lea
         ON lea.labor_entry_id = le.id
        AND lea.is_active = true
       WHERE le.client_id = $1
         AND le.worker_id = $2
         AND le.is_active = true
         AND le.work_date >= $3::date
         AND le.work_date <= $4::date
         AND le.cost_scope = 'farm'
     ) x
     WHERE lot_id IS NOT NULL
     GROUP BY lot_id`,
    [clientId, workerId, periodFrom, periodTo]
  );
  return res.rows.map((r) => ({ lot_id: r.lot_id, total: Number(r.total || 0) }));
}

async function sumLaborGross({ db, clientId, workerId, periodFrom, periodTo }) {
  const res = await db.query(
    `SELECT COALESCE(SUM(le.amount), 0)::numeric(14,2) AS gross
     FROM labor_entries le
     WHERE le.client_id = $1
       AND le.worker_id = $2
       AND le.is_active = true
       AND le.work_date >= $3::date
       AND le.work_date <= $4::date`,
    [clientId, workerId, periodFrom, periodTo]
  );
  return Number(res.rows[0]?.gross || 0);
}

function buildLotAllocations(totalLiability, lotRows) {
  if (!lotRows.length) {
    const err = new Error(
      'No hay labores registradas en el periodo para prorratear por lote. Registre labores con lote o asignación a lotes.'
    );
    err.status = 409;
    throw err;
  }
  let weights = lotRows.map((r) => ({ lot_id: r.lot_id, w: Math.max(0, Number(r.total) || 0) }));
  const sumW = weights.reduce((a, b) => a + b.w, 0);
  if (sumW <= 0) {
    weights = weights.map((x) => ({ lot_id: x.lot_id, w: 1 }));
  }
  const sumW2 = weights.reduce((a, b) => a + b.w, 0);
  const liability = round2(totalLiability);
  let allocated = 0;
  const out = weights.map((row, i) => {
    const isLast = i === weights.length - 1;
    const amt = isLast ? round2(liability - allocated) : round2((liability * row.w) / sumW2);
    allocated = round2(allocated + amt);
    const pct = round2((100 * row.w) / sumW2);
    return { lot_id: row.lot_id, allocation_pct: pct, amount_allocated: amt };
  });
  return out;
}

async function listPayrollSlips({ clientId, workerId, statusList, periodFrom, periodTo }) {
  const clauses = ['ps.client_id = $1'];
  const values = [clientId];
  let idx = 2;
  if (workerId) {
    clauses.push(`ps.worker_id = $${idx++}`);
    values.push(workerId);
  }
  if (Array.isArray(statusList) && statusList.length > 0) {
    clauses.push(`ps.status = ANY($${idx++}::payroll_slip_status[])`);
    values.push(statusList);
  }
  if (periodFrom) {
    clauses.push(`ps.period_to >= $${idx++}::date`);
    values.push(periodFrom);
  }
  if (periodTo) {
    clauses.push(`ps.period_from <= $${idx++}::date`);
    values.push(periodTo);
  }
  const res = await pool.query(
    `SELECT ps.*,
            concat_ws(' ', w.first_name, w.last_name_1, w.last_name_2) AS worker_name,
            COALESCE(
              (SELECT json_agg(ordered.j)
               FROM (
                 SELECT json_build_object(
                          'id', a.id,
                          'lot_id', a.lot_id,
                          'lot_name', l.name,
                          'allocation_pct', a.allocation_pct,
                          'amount_allocated', a.amount_allocated
                        ) AS j
                 FROM payroll_slip_lot_allocations a
                 JOIN lots l ON l.id = a.lot_id AND l.client_id = ps.client_id
                 WHERE a.payroll_slip_id = ps.id
                 ORDER BY l.name
               ) ordered),
              '[]'::json
            ) AS lot_allocations
     FROM payroll_slips ps
     JOIN workers w ON w.id = ps.worker_id AND w.client_id = ps.client_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY ps.period_from DESC, ps.created_at DESC`,
    values
  );
  return res.rows;
}

async function getPayrollSlipById({ id, clientId }) {
  const slipRes = await pool.query(
    `SELECT ps.*,
            concat_ws(' ', w.first_name, w.last_name_1, w.last_name_2) AS worker_name
     FROM payroll_slips ps
     JOIN workers w ON w.id = ps.worker_id AND w.client_id = ps.client_id
     WHERE ps.id = $1 AND ps.client_id = $2`,
    [id, clientId]
  );
  const slip = slipRes.rows[0];
  if (!slip) return null;
  const allocRes = await pool.query(
    `SELECT a.id, a.lot_id, l.name AS lot_name, a.allocation_pct, a.amount_allocated
     FROM payroll_slip_lot_allocations a
     JOIN payroll_slips ps ON ps.id = a.payroll_slip_id AND ps.client_id = $2
     JOIN lots l ON l.id = a.lot_id AND l.client_id = ps.client_id
     WHERE a.payroll_slip_id = $1
     ORDER BY l.name`,
    [id, clientId]
  );
  return { ...slip, lot_allocations: allocRes.rows };
}

async function calculatePayrollSlip({
  clientId,
  userId,
  workerId,
  periodFrom,
  periodTo,
  receivesAguinaldo,
  declaresCcss,
  monthlyGross,
}) {
  if (!workerId || !String(workerId).trim()) {
    const err = new Error('worker_id es obligatorio.');
    err.status = 400;
    throw err;
  }

  const pf = normalizeDate(periodFrom, { field: 'period_from' });
  const pt = normalizeDate(periodTo, { field: 'period_to' });
  if (pf > pt) {
    const err = new Error('period_from no puede ser posterior a period_to.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const worker = await getWorkerForClient({ db, workerId, clientId });
    const kind = String(worker.worker_type || '').toLowerCase();
    if (kind === 'fijo' && !isFullCalendarMonth(pf, pt)) {
      const err = new Error(
        'Para trabajador fijo el periodo debe ser un mes calendario completo (del día 1 al último día del mismo mes).'
      );
      err.status = 400;
      throw err;
    }

    await assertNoPaidPayrollOverlap({ db, clientId, workerId, periodFrom: pf, periodTo: pt });

    const existingSlipId = await findCalculadaSlipId({ db, clientId, workerId, periodFrom: pf, periodTo: pt });

    const derived = await computePayrollSlipDerivedValues({
      db,
      clientId,
      workerId,
      kind,
      pf,
      pt,
      receivesAguinaldo: !!receivesAguinaldo,
      declaresCcss: !!declaresCcss,
      monthlyGross,
    });

    let slipId;
    if (existingSlipId) {
      await db.query(
        `UPDATE payroll_slips
         SET worker_kind = $2,
             receives_aguinaldo = $3,
             declares_ccss = $4,
             gross_total = $5,
             employer_ccss_amount = $6,
             employer_other_amount = $7,
             employee_ccss_amount = $8,
             aguinaldo_provision = $9,
             total_employer_liability = $10,
             employer_ccss_pct_snapshot = $11,
             employer_other_pct_snapshot = $12,
             employee_pct_snapshot = $13,
             nomina_rule_id = $14,
             updated_at = NOW(),
             updated_by_user_id = $15
         WHERE id = $1
           AND client_id = $16`,
        [
          existingSlipId,
          kind,
          !!receivesAguinaldo,
          !!declaresCcss,
          derived.grossTotal,
          derived.employerCcss,
          derived.employerOther,
          derived.employeeCcss,
          derived.aguinaldoProvision,
          derived.totalEmployerLiability,
          derived.employerCcssPctSnap,
          derived.employerOtherPctSnap,
          derived.employeePctSnap,
          derived.nominaRuleId,
          userId,
          clientId,
        ]
      );
      slipId = existingSlipId;
    } else {
      const ins = await db.query(
        `INSERT INTO payroll_slips (
           client_id, worker_id, worker_kind, period_from, period_to,
           receives_aguinaldo, declares_ccss, status,
           gross_total, employer_ccss_amount, employer_other_amount, employee_ccss_amount,
           aguinaldo_provision, total_employer_liability,
           employer_ccss_pct_snapshot, employer_other_pct_snapshot, employee_pct_snapshot,
           nomina_rule_id, created_by_user_id, updated_by_user_id
         )
         VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'calculada',
                 $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
         RETURNING id`,
        [
          clientId,
          workerId,
          kind,
          pf,
          pt,
          !!receivesAguinaldo,
          !!declaresCcss,
          derived.grossTotal,
          derived.employerCcss,
          derived.employerOther,
          derived.employeeCcss,
          derived.aguinaldoProvision,
          derived.totalEmployerLiability,
          derived.employerCcssPctSnap,
          derived.employerOtherPctSnap,
          derived.employeePctSnap,
          derived.nominaRuleId,
          userId,
        ]
      );
      slipId = ins.rows[0].id;
    }

    await replaceSlipLotAllocations(db, clientId, slipId, derived.lotAllocations);

    await db.query('COMMIT');
    return getPayrollSlipById({ id: slipId, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function recalculatePayrollSlip({
  id,
  clientId,
  userId,
  monthlyGross: monthlyGrossOverride,
  receivesAguinaldo: receivesOverride,
  declaresCcss: declaresOverride,
}) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const slipRes = await db.query(
      `SELECT * FROM payroll_slips WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [id, clientId]
    );
    const slip = slipRes.rows[0];
    if (!slip) {
      const err = new Error('Planilla no encontrada.');
      err.status = 404;
      throw err;
    }
    if (String(slip.status) !== 'calculada') {
      const err = new Error('Solo se puede recalcular una planilla en estado calculada.');
      err.status = 409;
      throw err;
    }

    await getWorkerForClient({ db, workerId: slip.worker_id, clientId });
    const kind = String(slip.worker_kind || '').toLowerCase();
    const pf = String(slip.period_from).slice(0, 10);
    const pt = String(slip.period_to).slice(0, 10);

    if (kind === 'fijo' && !isFullCalendarMonth(pf, pt)) {
      const err = new Error(
        'Para trabajador fijo el periodo debe ser un mes calendario completo (del día 1 al último día del mismo mes).'
      );
      err.status = 400;
      throw err;
    }

    const receivesAguinaldo =
      receivesOverride !== undefined && receivesOverride !== null ? !!receivesOverride : !!slip.receives_aguinaldo;
    const declaresCcss =
      declaresOverride !== undefined && declaresOverride !== null ? !!declaresOverride : !!slip.declares_ccss;

    let monthlyGrossForCompute;
    if (kind === 'fijo') {
      monthlyGrossForCompute =
        monthlyGrossOverride !== undefined && monthlyGrossOverride !== null
          ? monthlyGrossOverride
          : Number(slip.gross_total);
    } else {
      monthlyGrossForCompute = undefined;
    }

    const derived = await computePayrollSlipDerivedValues({
      db,
      clientId,
      workerId: slip.worker_id,
      kind,
      pf,
      pt,
      receivesAguinaldo,
      declaresCcss,
      monthlyGross: monthlyGrossForCompute,
    });

    await db.query(
      `UPDATE payroll_slips
       SET receives_aguinaldo = $2,
           declares_ccss = $3,
           gross_total = $4,
           employer_ccss_amount = $5,
           employer_other_amount = $6,
           employee_ccss_amount = $7,
           aguinaldo_provision = $8,
           total_employer_liability = $9,
           employer_ccss_pct_snapshot = $10,
           employer_other_pct_snapshot = $11,
           employee_pct_snapshot = $12,
           nomina_rule_id = $13,
           updated_at = NOW(),
           updated_by_user_id = $14
       WHERE id = $1
         AND client_id = $15`,
      [
        id,
        receivesAguinaldo,
        declaresCcss,
        derived.grossTotal,
        derived.employerCcss,
        derived.employerOther,
        derived.employeeCcss,
        derived.aguinaldoProvision,
        derived.totalEmployerLiability,
        derived.employerCcssPctSnap,
        derived.employerOtherPctSnap,
        derived.employeePctSnap,
        derived.nominaRuleId,
        userId,
        clientId,
      ]
    );

    await replaceSlipLotAllocations(db, clientId, id, derived.lotAllocations);

    await db.query('COMMIT');
    return getPayrollSlipById({ id, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function updatePayrollSlipStatus({ id, clientId, userId, status }) {
  const s = String(status || '').trim().toLowerCase();
  if (!['pagada', 'cancelada'].includes(s)) {
    const err = new Error('Solo se puede pasar a estado pagada o cancelada.');
    err.status = 400;
    throw err;
  }
  const res = await pool.query(
    `UPDATE payroll_slips
     SET status = $1::payroll_slip_status,
         updated_at = NOW(),
         updated_by_user_id = $2
     WHERE id = $3
       AND client_id = $4
       AND status = 'calculada'
     RETURNING id`,
    [s, userId, id, clientId]
  );
  if (!res.rows[0]) {
    const err = new Error('Planilla no encontrada o no está en estado calculada.');
    err.status = 404;
    throw err;
  }
  return getPayrollSlipById({ id, clientId });
}

module.exports = {
  listPayrollSlips,
  getPayrollSlipById,
  calculatePayrollSlip,
  recalculatePayrollSlip,
  updatePayrollSlipStatus,
};
