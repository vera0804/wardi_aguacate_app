const { pool } = require('../db');
const allocationsService = require('./labor-entry-allocations.service');
const calendarActivitiesService = require('./calendar-activities.service');

const ALLOWED_UNITS = new Set(['jornal', 'hora', 'caja', 'bolsas']);
const JOURNAL_UNIT = 'jornal';

function toDbUnit(unit) {
  const v = String(unit || '').trim().toLowerCase();
  return v;
}

function fromDbUnit(unit) {
  return String(unit || '').trim().toLowerCase();
}

function normalizeText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v || null;
}

function normalizeScope(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!['lot', 'farm'].includes(v)) {
    const err = new Error("cost_scope debe ser 'lot' o 'farm'.");
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeUnit(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!ALLOWED_UNITS.has(v)) {
    const err = new Error('unit debe ser jornal, hora, caja o bolsas.');
    err.status = 400;
    throw err;
  }
  return toDbUnit(v);
}

function normalizeQty(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error('qty debe ser mayor que 0.');
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeRate(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error('rate_applied debe ser mayor o igual a 0.');
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeDate(value, { required = false, field = 'work_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function assertScopeReferences({ scope, lotId, farmId }) {
  if (scope === 'lot') {
    if (!lotId || farmId) {
      const err = new Error("En scope 'lot', lot_id es obligatorio y farm_id debe ser null.");
      err.status = 400;
      throw err;
    }
  } else if (scope === 'farm') {
    if (!farmId || lotId) {
      const err = new Error("En scope 'farm', farm_id es obligatorio y lot_id debe ser null.");
      err.status = 400;
      throw err;
    }
  }
}

function assertJornalRules({ unit, qty }) {
  if (unit === JOURNAL_UNIT && Number(qty) !== 1) {
    const err = new Error('Para unidad jornal, qty debe ser 1.');
    err.status = 400;
    throw err;
  }
}

async function getFarmById({ db, farmId, clientId }) {
  const res = await db.query(
    `SELECT id, labor_allocation_mode, is_active
     FROM farms
     WHERE id = $1
       AND client_id = $2`,
    [farmId, clientId]
  );
  return res.rows[0] || null;
}

async function getLotById({ db, lotId, clientId }) {
  const res = await db.query(
    `SELECT id, farm_id, is_active
     FROM lots
     WHERE id = $1
       AND client_id = $2`,
    [lotId, clientId]
  );
  return res.rows[0] || null;
}

async function ensureWorkerAndLaborType({ db, workerId, laborTypeId, unit, clientId }) {
  const workerRes = await db.query(
    `SELECT id, worker_type, is_active
     FROM workers
     WHERE id = $1
       AND client_id = $2`,
    [workerId, clientId]
  );
  const worker = workerRes.rows[0];
  if (!worker || !worker.is_active) {
    const err = new Error('Trabajador no encontrado o inactivo.');
    err.status = 409;
    throw err;
  }

  // Regla explícita de negocio para trabajador fijo.
  if (worker.worker_type === 'fijo' && !ALLOWED_UNITS.has(unit)) {
    const err = new Error('Unidad no permitida para trabajador fijo.');
    err.status = 400;
    throw err;
  }

  const laborRes = await db.query(
    `SELECT id, is_active
     FROM labor_types
     WHERE id = $1`,
    [laborTypeId]
  );
  const laborType = laborRes.rows[0];
  if (!laborType || !laborType.is_active) {
    const err = new Error('Tipo de labor no encontrado o inactivo.');
    err.status = 409;
    throw err;
  }

  return worker;
}

async function validateScopeEntities({ db, scope, lotId, farmId, clientId }) {
  if (scope === 'lot') {
    const lot = await getLotById({ db, lotId, clientId });
    if (!lot || !lot.is_active) {
      const err = new Error('Lote no encontrado o inactivo.');
      err.status = 409;
      throw err;
    }
    return { lot, farm: null };
  }

  const farm = await getFarmById({ db, farmId, clientId });
  if (!farm || !farm.is_active) {
    const err = new Error('Finca no encontrada o inactiva.');
    err.status = 409;
    throw err;
  }
  return { lot: null, farm };
}

async function assertUniqueActiveJornal({ db, clientId, workerId, workDate, excludeId = null }) {
  const res = await db.query(
    `SELECT id
     FROM labor_entries
     WHERE is_active = true
       AND client_id = $4
       AND worker_id = $1
       AND work_date = $2
       AND unit = 'jornal'
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [workerId, workDate, excludeId, clientId]
  );
  if (res.rows[0]) {
    const err = new Error('El trabajador ya tiene un jornal activo en esa fecha.');
    err.status = 409;
    throw err;
  }
}

async function assertNoDuplicateActiveEntry({
  db,
  clientId,
  scope,
  workerId,
  lotId,
  farmId,
  laborTypeId,
  unit,
  workDate,
  excludeId = null,
}) {
  const res = await db.query(
    `SELECT id
     FROM labor_entries
     WHERE is_active = true
       AND client_id = $9
       AND worker_id = $1
       AND labor_type_id = $2
       AND unit = $3
       AND work_date = $4
       AND cost_scope = $5
       AND (
         ($5 = 'lot' AND lot_id = $6 AND farm_id IS NULL)
         OR ($5 = 'farm' AND farm_id = $7 AND lot_id IS NULL)
       )
       AND ($8::uuid IS NULL OR id <> $8::uuid)
     LIMIT 1`,
    [workerId, laborTypeId, unit, workDate, scope, lotId || null, farmId || null, excludeId, clientId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe un registro activo con la misma combinación.');
    err.status = 409;
    throw err;
  }
}

async function enrichWithAllocations({ db, rows, clientId }) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const allocRes = await db.query(
    `SELECT lea.labor_entry_id,
            lea.lot_id,
            lea.allocation_pct,
            lea.amount_allocated,
            l.name AS lot_name
     FROM labor_entry_allocations lea
     INNER JOIN labor_entries le ON le.id = lea.labor_entry_id AND le.client_id = $2
     JOIN lots l ON l.id = lea.lot_id AND l.client_id = $2
     WHERE lea.labor_entry_id = ANY($1::uuid[])
       AND lea.is_active = true
     ORDER BY l.name ASC`,
    [ids, clientId]
  );
  const byEntry = new Map();
  for (const row of allocRes.rows) {
    if (!byEntry.has(row.labor_entry_id)) byEntry.set(row.labor_entry_id, []);
    byEntry.get(row.labor_entry_id).push(row);
  }
  return rows.map((r) => ({
    ...r,
    unit: fromDbUnit(r.unit),
    allocations: byEntry.get(r.id) || [],
  }));
}

async function listLaborEntries({ clientId, filters }) {
  const q = filters || {};
  const clauses = [];
  const values = [];
  let idx = 1;

  if (q.fromDate) {
    clauses.push(`le.work_date >= $${idx++}`);
    values.push(q.fromDate);
  }
  if (q.toDate) {
    clauses.push(`le.work_date <= $${idx++}`);
    values.push(q.toDate);
  }
  if (q.scope) {
    clauses.push(`le.cost_scope = $${idx++}`);
    values.push(q.scope);
  }
  if (q.farmId) {
    clauses.push(`le.farm_id = $${idx++}`);
    values.push(q.farmId);
  }
  if (q.lotId) {
    clauses.push(`le.lot_id = $${idx++}`);
    values.push(q.lotId);
  }
  if (q.workerId) {
    clauses.push(`le.worker_id = $${idx++}`);
    values.push(q.workerId);
  }
  if (q.active !== undefined) {
    clauses.push(`le.is_active = $${idx++}`);
    values.push(q.active);
  }

  clauses.push(`le.client_id = $${idx++}`);
  values.push(clientId);
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT le.id, le.cost_scope, le.lot_id, le.farm_id, le.worker_id, le.labor_type_id,
            le.work_date, le.unit, le.qty, le.rate_applied, le.amount,
            le.notes, le.is_active, le.created_at, le.updated_at,
            w.first_name, w.last_name_1, w.last_name_2, w.worker_type,
            lt.name AS labor_type_name,
            l.name AS lot_name,
            f.name AS farm_name
     FROM labor_entries le
     JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
     JOIN labor_types lt ON lt.id = le.labor_type_id
     LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
     LEFT JOIN farms f ON f.id = le.farm_id AND f.client_id = le.client_id
     ${whereSql}
     ORDER BY le.work_date DESC, le.created_at DESC`,
    values
  );
  return enrichWithAllocations({ db: pool, rows: res.rows, clientId });
}

async function getLaborEntryById({ id, clientId }) {
  const res = await pool.query(
    `SELECT le.id, le.cost_scope, le.lot_id, le.farm_id, le.worker_id, le.labor_type_id,
            le.work_date, le.unit, le.qty, le.rate_applied, le.amount,
            le.notes, le.is_active, le.created_at, le.updated_at,
            w.first_name, w.last_name_1, w.last_name_2, w.worker_type,
            lt.name AS labor_type_name,
            l.name AS lot_name,
            f.name AS farm_name
     FROM labor_entries le
     JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
     JOIN labor_types lt ON lt.id = le.labor_type_id
     LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
     LEFT JOIN farms f ON f.id = le.farm_id AND f.client_id = le.client_id
     WHERE le.id = $1
       AND le.client_id = $2`,
    [id, clientId]
  );
  const enriched = await enrichWithAllocations({ db: pool, rows: res.rows, clientId });
  return enriched[0] || null;
}

async function assertWorkerWorkDateNotUnderPaidPayrollSlip({ db, clientId, workerId, workDate }) {
  const d = String(workDate).slice(0, 10);
  const res = await db.query(
    `SELECT ps.period_from, ps.period_to
     FROM payroll_slips ps
     WHERE ps.client_id = $1
       AND ps.worker_id = $2
       AND ps.status = 'pagada'
       AND ps.period_from <= $3::date
       AND ps.period_to >= $3::date
     LIMIT 1`,
    [clientId, workerId, d]
  );
  if (res.rows[0]) {
    const p = res.rows[0];
    const err = new Error(
      `No se puede modificar esta labor: hay una planilla pagada que cubre la fecha (${String(p.period_from).slice(0, 10)} a ${String(p.period_to).slice(0, 10)}).`
    );
    err.status = 409;
    throw err;
  }
}

async function createLaborEntryTx({ db, clientId, userId, payload }) {
  const scope = normalizeScope(payload.cost_scope, { required: true });
  const lotId = normalizeText(payload.lot_id);
  const farmId = normalizeText(payload.farm_id);
  const workerId = normalizeText(payload.worker_id);
  const laborTypeId = normalizeText(payload.labor_type_id);
  const workDate = normalizeDate(payload.work_date, { required: true });
  const unit = normalizeUnit(payload.unit, { required: true });
  const qty = normalizeQty(payload.qty, { required: true });
  const notes = normalizeText(payload.notes);

  if (!workerId || !laborTypeId) {
    const err = new Error('worker_id y labor_type_id son obligatorios.');
    err.status = 400;
    throw err;
  }

  assertScopeReferences({ scope, lotId, farmId });
  assertJornalRules({ unit, qty });
  const worker = await ensureWorkerAndLaborType({ db, workerId, laborTypeId, unit, clientId });
  let rateApplied = normalizeRate(payload.rate_applied, { required: true });
  if (worker.worker_type === 'fijo') {
    rateApplied = 0;
  }
  const entities = await validateScopeEntities({ db, scope, lotId, farmId, clientId });

  if (unit === JOURNAL_UNIT) {
    await assertUniqueActiveJornal({ db, clientId, workerId, workDate });
  }
  await assertNoDuplicateActiveEntry({
    db,
    clientId,
    scope,
    workerId,
    lotId,
    farmId,
    laborTypeId,
    unit,
    workDate,
  });
  await assertWorkerWorkDateNotUnderPaidPayrollSlip({ db, clientId, workerId, workDate });

  const insertRes = await db.query(
      `INSERT INTO labor_entries (
       lot_id, farm_id, cost_scope, worker_id, labor_type_id, work_date,
       unit, qty, rate_applied, notes, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     RETURNING id, amount`,
    [
      scope === 'lot' ? lotId : null,
      scope === 'farm' ? farmId : null,
      scope,
      workerId,
      laborTypeId,
      workDate,
      unit,
      qty,
      rateApplied,
      notes,
      clientId,
      userId,
    ]
  );

  const entryId = insertRes.rows[0].id;
  const totalAmount = Number(insertRes.rows[0].amount || 0);

  if (scope === 'farm') {
    const allocations = await allocationsService.resolveFarmAllocations({
      db,
      farmId,
      clientId,
      laborAllocationMode: entities.farm.labor_allocation_mode,
      allocations: payload.allocations,
    });
    await allocationsService.replaceLaborEntryAllocations({
      db,
      laborEntryId: entryId,
      clientId,
      allocations,
      totalAmount,
    });
  }

  const finalRes = await db.query(
    `SELECT le.id, le.cost_scope, le.lot_id, le.farm_id, le.worker_id, le.labor_type_id,
            le.work_date, le.unit, le.qty, le.rate_applied, le.amount,
            le.notes, le.is_active, le.created_at, le.updated_at,
            w.first_name, w.last_name_1, w.last_name_2, w.worker_type,
            lt.name AS labor_type_name,
            l.name AS lot_name,
            f.name AS farm_name
     FROM labor_entries le
     JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
     JOIN labor_types lt ON lt.id = le.labor_type_id
     LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
     LEFT JOIN farms f ON f.id = le.farm_id AND f.client_id = le.client_id
     WHERE le.id = $1
       AND le.client_id = $2`,
    [entryId, clientId]
  );

  const enriched = await enrichWithAllocations({ db, rows: finalRes.rows, clientId });
  const row = enriched[0];
  await calendarActivitiesService.syncCalendarActivityFromLabor({
    db,
    clientId,
    userId,
    entry: {
      cost_scope: scope,
      lot_id: scope === 'lot' ? lotId : null,
      farm_id: scope === 'farm' ? farmId : null,
      labor_type_id: laborTypeId,
      work_date: workDate,
    },
  });
  return row;
}

async function createLaborEntry({ clientId, userId, payload }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const created = await createLaborEntryTx({ db, clientId, userId, payload });
    await db.query('COMMIT');
    return created;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

function buildDateRange(fromDate, toDate) {
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    const err = new Error('Rango de fechas inválido.');
    err.status = 400;
    throw err;
  }
  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function createLaborEntriesBulk({ clientId, userId, payload }) {
  const fromDate = normalizeDate(payload.from_date, { required: true, field: 'from_date' });
  const toDate = normalizeDate(payload.to_date, { required: true, field: 'to_date' });
  const dates = buildDateRange(fromDate, toDate);
  const dailyItems = Array.isArray(payload.daily_items) ? payload.daily_items : null;

  let itemsByDate = null;
  if (dailyItems && dailyItems.length > 0) {
    itemsByDate = new Map();
    for (const item of dailyItems) {
      const d = normalizeDate(item?.work_date, { required: true, field: 'daily_items.work_date' });
      const q = normalizeQty(item?.qty, { required: true });
      const r =
        item?.rate_applied !== undefined
          ? normalizeRate(item?.rate_applied, { required: true })
          : undefined;
      itemsByDate.set(d, { qty: q, rate_applied: r });
    }
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const created = [];
    for (const date of dates) {
      const item = itemsByDate?.get(date);
      const row = await createLaborEntryTx({
        db,
        clientId,
        userId,
        payload: {
          ...payload,
          work_date: date,
          qty: item ? item.qty : payload.qty,
          rate_applied:
            item && item.rate_applied !== undefined
              ? item.rate_applied
              : payload.rate_applied,
        },
      });
      created.push(row);
    }
    await db.query('COMMIT');
    return created;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function updateLaborEntry({ id, clientId, userId, payload }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const currentRes = await db.query(
      `SELECT * FROM labor_entries WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );
    const current = currentRes.rows[0];
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }

    const scope =
      payload.cost_scope !== undefined
        ? normalizeScope(payload.cost_scope, { required: true })
        : current.cost_scope;
    const lotId =
      payload.lot_id !== undefined ? normalizeText(payload.lot_id) : current.lot_id;
    const farmId =
      payload.farm_id !== undefined ? normalizeText(payload.farm_id) : current.farm_id;
    const workerId =
      payload.worker_id !== undefined ? normalizeText(payload.worker_id) : current.worker_id;
    const laborTypeId =
      payload.labor_type_id !== undefined
        ? normalizeText(payload.labor_type_id)
        : current.labor_type_id;
    const workDate =
      payload.work_date !== undefined
        ? normalizeDate(payload.work_date, { required: true })
        : String(current.work_date).slice(0, 10);
    const unit =
      payload.unit !== undefined ? normalizeUnit(payload.unit, { required: true }) : current.unit;
    const qty =
      payload.qty !== undefined ? normalizeQty(payload.qty, { required: true }) : Number(current.qty);
    let rateApplied =
      payload.rate_applied !== undefined
        ? normalizeRate(payload.rate_applied, { required: true })
        : Number(current.rate_applied);
    const notes = payload.notes !== undefined ? normalizeText(payload.notes) : current.notes;

    if (!workerId || !laborTypeId) {
      const err = new Error('worker_id y labor_type_id son obligatorios.');
      err.status = 400;
      throw err;
    }

    const curDate = String(current.work_date).slice(0, 10);
    const curWorker = current.worker_id;
    await assertWorkerWorkDateNotUnderPaidPayrollSlip({
      db,
      clientId,
      workerId: curWorker,
      workDate: curDate,
    });
    if (workerId !== curWorker || workDate !== curDate) {
      await assertWorkerWorkDateNotUnderPaidPayrollSlip({ db, clientId, workerId, workDate });
    }

    assertScopeReferences({ scope, lotId, farmId });
    assertJornalRules({ unit, qty });
    const worker = await ensureWorkerAndLaborType({ db, workerId, laborTypeId, unit, clientId });
    if (worker.worker_type === 'fijo') {
      rateApplied = 0;
    }
    const entities = await validateScopeEntities({ db, scope, lotId, farmId, clientId });

    if (unit === JOURNAL_UNIT && current.is_active) {
      await assertUniqueActiveJornal({
        db,
        clientId,
        workerId,
        workDate,
        excludeId: id,
      });
    }
    if (current.is_active) {
      await assertNoDuplicateActiveEntry({
        db,
        clientId,
        scope,
        workerId,
        lotId,
        farmId,
        laborTypeId,
        unit,
        workDate,
        excludeId: id,
      });
    }

    const updRes = await db.query(
      `UPDATE labor_entries
       SET lot_id = $2,
           farm_id = $3,
           cost_scope = $4,
           worker_id = $5,
           labor_type_id = $6,
           work_date = $7,
           unit = $8,
           qty = $9,
           rate_applied = $10,
           notes = $11,
           updated_by_user_id = $12,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $13
       RETURNING id, amount`,
      [
        id,
        scope === 'lot' ? lotId : null,
        scope === 'farm' ? farmId : null,
        scope,
        workerId,
        laborTypeId,
        workDate,
        unit,
        qty,
        rateApplied,
        notes,
        userId,
        clientId,
      ]
    );

    const totalAmount = Number(updRes.rows[0].amount || 0);

    if (scope === 'farm') {
      const allocations = await allocationsService.resolveFarmAllocations({
        db,
        farmId,
        clientId,
        laborAllocationMode: entities.farm.labor_allocation_mode,
        allocations: payload.allocations,
      });
      await allocationsService.replaceLaborEntryAllocations({
        db,
        laborEntryId: id,
        clientId,
        allocations,
        totalAmount,
      });
    } else {
      await allocationsService.replaceLaborEntryAllocations({
        db,
        laborEntryId: id,
        clientId,
        allocations: [],
        totalAmount: 0,
      });
    }

    const finalRes = await db.query(
      `SELECT le.id, le.cost_scope, le.lot_id, le.farm_id, le.worker_id, le.labor_type_id,
              le.work_date, le.unit, le.qty, le.rate_applied, le.amount,
              le.notes, le.is_active, le.created_at, le.updated_at,
              w.first_name, w.last_name_1, w.last_name_2, w.worker_type,
              lt.name AS labor_type_name,
              l.name AS lot_name,
              f.name AS farm_name
       FROM labor_entries le
       JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
       JOIN labor_types lt ON lt.id = le.labor_type_id
       LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
       LEFT JOIN farms f ON f.id = le.farm_id AND f.client_id = le.client_id
       WHERE le.id = $1
         AND le.client_id = $2`,
      [id, clientId]
    );
    const enriched = await enrichWithAllocations({ db, rows: finalRes.rows, clientId });
    await db.query('COMMIT');
    return enriched[0];
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function setLaborEntryActive({ id, clientId, userId, isActive }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(
      `SELECT * FROM labor_entries WHERE id = $1 AND client_id = $2`,
      [id, clientId]
    );
    const current = curRes.rows[0];
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }

    await assertWorkerWorkDateNotUnderPaidPayrollSlip({
      db,
      clientId,
      workerId: current.worker_id,
      workDate: String(current.work_date).slice(0, 10),
    });

    if (isActive && current.unit === JOURNAL_UNIT) {
      await assertUniqueActiveJornal({
        db,
        clientId,
        workerId: current.worker_id,
        workDate: String(current.work_date).slice(0, 10),
        excludeId: id,
      });
    }
    if (isActive) {
      await assertNoDuplicateActiveEntry({
        db,
        clientId,
        scope: current.cost_scope,
        workerId: current.worker_id,
        lotId: current.lot_id,
        farmId: current.farm_id,
        laborTypeId: current.labor_type_id,
        unit: current.unit,
        workDate: String(current.work_date).slice(0, 10),
        excludeId: id,
      });
    }

    await db.query(
      `UPDATE labor_entries
       SET is_active = $2,
           updated_by_user_id = $3,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $4`,
      [id, !!isActive, userId, clientId]
    );
    const finalRes = await db.query(
      `SELECT le.id, le.cost_scope, le.lot_id, le.farm_id, le.worker_id, le.labor_type_id,
              le.work_date, le.unit, le.qty, le.rate_applied, le.amount,
              le.notes, le.is_active, le.created_at, le.updated_at,
              w.first_name, w.last_name_1, w.last_name_2, w.worker_type,
              lt.name AS labor_type_name,
              l.name AS lot_name,
              f.name AS farm_name
       FROM labor_entries le
       JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
       JOIN labor_types lt ON lt.id = le.labor_type_id
       LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
       LEFT JOIN farms f ON f.id = le.farm_id AND f.client_id = le.client_id
       WHERE le.id = $1
         AND le.client_id = $2`,
      [id, clientId]
    );
    const enriched = await enrichWithAllocations({ db, rows: finalRes.rows, clientId });
    await db.query('COMMIT');
    return enriched[0];
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function getSummaryByLot({ clientId, fromDate, toDate, farmId, lotId }) {
  const clauses = ['le.is_active = true', 'le.client_id = $1'];
  const values = [];
  let idx = 2;
  values.push(clientId);

  if (fromDate) {
    clauses.push(`le.work_date >= $${idx++}`);
    values.push(fromDate);
  }
  if (toDate) {
    clauses.push(`le.work_date <= $${idx++}`);
    values.push(toDate);
  }
  if (farmId) {
    const farmParam = idx++;
    clauses.push(`(le.farm_id = $${farmParam} OR l.farm_id = $${farmParam})`);
    values.push(farmId);
  }
  if (lotId) {
    clauses.push(`COALESCE(lea.lot_id, le.lot_id) = $${idx++}`);
    values.push(lotId);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT COALESCE(lea.lot_id, le.lot_id) AS lot_id,
            COALESCE(l2.name, l.name) AS lot_name,
            SUM(
              CASE
                WHEN le.cost_scope = 'farm' THEN le.amount * (COALESCE(lea.allocation_pct, 0) / 100.0)
                ELSE le.amount
              END
            )::numeric(14,2) AS total_amount
     FROM labor_entries le
     LEFT JOIN labor_entry_allocations lea
       ON lea.labor_entry_id = le.id AND lea.is_active = true
     LEFT JOIN lots l ON l.id = le.lot_id AND l.client_id = le.client_id
     LEFT JOIN lots l2 ON l2.id = lea.lot_id AND l2.client_id = le.client_id
     ${whereSql}
     GROUP BY COALESCE(lea.lot_id, le.lot_id), COALESCE(l2.name, l.name)
     ORDER BY lot_name ASC`,
    values
  );
  return res.rows;
}

async function getSummaryByWorker({ clientId, fromDate, toDate, workerId }) {
  const clauses = ['le.is_active = true', 'le.client_id = $1'];
  const values = [];
  let idx = 2;
  values.push(clientId);

  if (fromDate) {
    clauses.push(`le.work_date >= $${idx++}`);
    values.push(fromDate);
  }
  if (toDate) {
    clauses.push(`le.work_date <= $${idx++}`);
    values.push(toDate);
  }
  if (workerId) {
    clauses.push(`le.worker_id = $${idx++}`);
    values.push(workerId);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const res = await pool.query(
    `SELECT le.worker_id,
            concat_ws(' ', w.first_name, w.last_name_1, w.last_name_2) AS worker_name,
            SUM(le.amount)::numeric(14,2) AS total_amount,
            COUNT(*)::int AS entries_count
     FROM labor_entries le
     JOIN workers w ON w.id = le.worker_id AND w.client_id = le.client_id
     ${whereSql}
     GROUP BY le.worker_id, worker_name
     ORDER BY worker_name ASC`,
    values
  );
  return res.rows;
}

async function getMeta({ clientId }) {
  const [farms, lots, workers, laborTypes] = await Promise.all([
    pool.query(
      `SELECT id, name, labor_allocation_mode
       FROM farms
       WHERE is_active = true
         AND client_id = $1
       ORDER BY name ASC`,
      [clientId]
    ),
    pool.query(
      `SELECT id, farm_id, name, area_ha
       FROM lots
       WHERE is_active = true
         AND client_id = $1
       ORDER BY name ASC`,
      [clientId]
    ),
    pool.query(
      `SELECT id, worker_type, first_name, last_name_1, last_name_2
       FROM workers
       WHERE is_active = true
         AND client_id = $1
       ORDER BY first_name ASC, last_name_1 ASC`,
      [clientId]
    ),
    pool.query(`SELECT id, name FROM labor_types WHERE is_active = true ORDER BY name ASC`),
  ]);

  return {
    farms: farms.rows,
    lots: lots.rows,
    workers: workers.rows.map((w) => ({
      ...w,
      display_name: [w.first_name, w.last_name_1, w.last_name_2].filter(Boolean).join(' '),
    })),
    laborTypes: laborTypes.rows,
    units: ['jornal', 'hora', 'caja', 'bolsas'],
  };
}

module.exports = {
  listLaborEntries,
  getLaborEntryById,
  createLaborEntry,
  createLaborEntriesBulk,
  updateLaborEntry,
  setLaborEntryActive,
  getSummaryByLot,
  getSummaryByWorker,
  getMeta,
};

