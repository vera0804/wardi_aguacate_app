const { pool } = require('../db');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Año al 30 de noviembre que cierra el periodo legal: 1 dic (año-1) – 30 nov (año). */
function legalPeriodFromNovYear(novYear) {
  const y = Number(novYear);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    const err = new Error('legal_nov_year debe ser un año entero válido (ej. 2025 para dic 2024 – nov 2025).');
    err.status = 400;
    throw err;
  }
  const legal_period_from = `${y - 1}-12-01`;
  const legal_period_to = `${y}-11-30`;
  return { legal_period_from, legal_period_to };
}

async function getWorkerForClient({ db, workerId, clientId }) {
  const res = await db.query(
    `SELECT id, client_id, is_active
     FROM workers
     WHERE id = $1`,
    [workerId]
  );
  const w = res.rows[0];
  if (!w || String(w.client_id) !== String(clientId)) {
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

async function sumPaidSlipsInLegalPeriod({ db, clientId, workerId, legalFrom, legalTo }) {
  const res = await db.query(
    `SELECT COALESCE(SUM(ps.gross_total), 0)::numeric(14,2) AS total_gross,
            COUNT(*)::int AS slip_count,
            json_agg(ps.id ORDER BY ps.period_from) AS slip_ids
     FROM payroll_slips ps
     WHERE ps.client_id = $1
       AND ps.worker_id = $2
       AND ps.status = 'pagada'
       AND ps.period_from <= $4::date
       AND ps.period_to >= $3::date`,
    [clientId, workerId, legalFrom, legalTo]
  );
  if (!res.rows.length) {
    return { totalGross: 0, slipCount: 0, slipIds: [] };
  }
  const row = res.rows[0];
  const totalGross = Number(row?.total_gross || 0);
  const slipCount = Number(row?.slip_count || 0);
  let slipIds = row?.slip_ids;
  if (slipIds == null) slipIds = [];
  if (!Array.isArray(slipIds)) slipIds = [slipIds].filter(Boolean);
  return { totalGross, slipCount, slipIds };
}

async function listAguinaldoStatements({
  clientId,
  workerId,
  statusList,
  periodFrom,
  periodTo,
}) {
  const clauses = ['a.client_id = $1'];
  const values = [clientId];
  let idx = 2;

  if (workerId) {
    clauses.push(`a.worker_id = $${idx++}`);
    values.push(workerId);
  }
  if (Array.isArray(statusList) && statusList.length > 0) {
    clauses.push(`a.status = ANY($${idx++}::aguinaldo_statement_status[])`);
    values.push(statusList);
  }
  if (periodFrom) {
    clauses.push(`a.legal_period_to >= $${idx++}::date`);
    values.push(periodFrom);
  }
  if (periodTo) {
    clauses.push(`a.legal_period_from <= $${idx++}::date`);
    values.push(periodTo);
  }

  const res = await pool.query(
    `SELECT a.*,
            concat_ws(' ', w.first_name, w.last_name_1, w.last_name_2) AS worker_name
     FROM aguinaldo_statements a
     JOIN workers w ON w.id = a.worker_id AND w.client_id = a.client_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY a.legal_period_to DESC, a.updated_at DESC`,
    values
  );
  return res.rows;
}

async function getAguinaldoStatementById({ id, clientId }) {
  const res = await pool.query(
    `SELECT a.*,
            concat_ws(' ', w.first_name, w.last_name_1, w.last_name_2) AS worker_name
     FROM aguinaldo_statements a
     JOIN workers w ON w.id = a.worker_id AND w.client_id = a.client_id
     WHERE a.id = $1 AND a.client_id = $2`,
    [id, clientId]
  );
  return res.rows[0] || null;
}

/**
 * Calcula o actualiza aguinaldo (solo planillas pagadas). Si ya existe pagado, error.
 * Si existe calculado o cancelado, actualiza a calculado con nuevos montos.
 */
async function calculateAguinaldoStatement({ clientId, userId, workerId, legalNovYear }) {
  const { legal_period_from, legal_period_to } = legalPeriodFromNovYear(legalNovYear);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await getWorkerForClient({ db, workerId, clientId });

    const { totalGross, slipCount, slipIds } = await sumPaidSlipsInLegalPeriod({
      db,
      clientId,
      workerId,
      legalFrom: legal_period_from,
      legalTo: legal_period_to,
    });

    const aguinaldoAmount = round2(totalGross / 12);

    const existingRes = await db.query(
      `SELECT id, status::text AS status
       FROM aguinaldo_statements
       WHERE client_id = $1
         AND worker_id = $2
         AND legal_period_from = $3::date
         AND legal_period_to = $4::date
       FOR UPDATE`,
      [clientId, workerId, legal_period_from, legal_period_to]
    );
    const existing = existingRes.rows[0];

    if (existing?.status === 'pagado') {
      const err = new Error(
        'Este aguinaldo ya está marcado como pagado. No se puede recalcular; cancele el registro si debe reabrir el proceso.'
      );
      err.status = 409;
      throw err;
    }

    let row;
    if (existing) {
      const upd = await db.query(
        `UPDATE aguinaldo_statements
         SET total_gross_from_slips = $1,
             slip_count = $2,
             aguinaldo_amount = $3,
             contributing_slip_ids = $4::jsonb,
             status = 'calculado',
             updated_at = NOW(),
             updated_by_user_id = $5
         WHERE id = $6
         RETURNING *`,
        [totalGross, slipCount, aguinaldoAmount, JSON.stringify(slipIds), userId, existing.id]
      );
      row = upd.rows[0];
    } else {
      const ins = await db.query(
        `INSERT INTO aguinaldo_statements (
           client_id, worker_id, legal_period_from, legal_period_to,
           total_gross_from_slips, slip_count, aguinaldo_amount, contributing_slip_ids,
           status, created_by_user_id, updated_by_user_id
         )
         VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8::jsonb, 'calculado', $9, $9)
         RETURNING *`,
        [
          clientId,
          workerId,
          legal_period_from,
          legal_period_to,
          totalGross,
          slipCount,
          aguinaldoAmount,
          JSON.stringify(slipIds),
          userId,
        ]
      );
      row = ins.rows[0];
    }

    await db.query('COMMIT');
    return getAguinaldoStatementById({ id: row.id, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function recalculateAguinaldoStatement({ id, clientId, userId }) {
  const cur = await getAguinaldoStatementById({ id, clientId });
  if (!cur) {
    const err = new Error('Registro de aguinaldo no encontrado.');
    err.status = 404;
    throw err;
  }
  if (cur.status !== 'calculado') {
    const err = new Error('Solo se puede recalcular un aguinaldo en estado calculado.');
    err.status = 409;
    throw err;
  }
  const novYear = Number(String(cur.legal_period_to).slice(0, 4));
  return calculateAguinaldoStatement({ clientId, userId, workerId: cur.worker_id, legalNovYear: novYear });
}

async function updateAguinaldoStatementStatus({ id, clientId, userId, status }) {
  const s = String(status || '').trim().toLowerCase();
  if (!['pagado', 'cancelado'].includes(s)) {
    const err = new Error('Solo se puede pasar a estado pagado o cancelado.');
    err.status = 400;
    throw err;
  }
  const res = await pool.query(
    `UPDATE aguinaldo_statements
     SET status = $1::aguinaldo_statement_status,
         updated_at = NOW(),
         updated_by_user_id = $2
     WHERE id = $3
       AND client_id = $4
       AND status = 'calculado'
     RETURNING id`,
    [s, userId, id, clientId]
  );
  if (!res.rows[0]) {
    const err = new Error('Registro no encontrado o no está en estado calculado.');
    err.status = 404;
    throw err;
  }
  return getAguinaldoStatementById({ id, clientId });
}

module.exports = {
  listAguinaldoStatements,
  getAguinaldoStatementById,
  calculateAguinaldoStatement,
  recalculateAguinaldoStatement,
  updateAguinaldoStatementStatus,
  legalPeriodFromNovYear,
};
