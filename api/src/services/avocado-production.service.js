const { pool } = require('../db');
const allocationsService = require('./labor-entry-allocations.service');

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

function normalizeDate(value, { required = false, field = 'prod_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw;
}

function normalizeNonNegative(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${field} debe ser mayor o igual a 0.`);
    err.status = 400;
    throw err;
  }
  return n;
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

async function validateDetails({ db, details, clientId, allowInactiveCaliberIds = [] }) {
  if (!Array.isArray(details) || details.length === 0) {
    const err = new Error('Debes enviar al menos un detalle de calibre.');
    err.status = 400;
    throw err;
  }

  const normalized = details.map((d) => ({
    caliber_id: normalizeText(d?.caliber_id),
    kilos: normalizeNonNegative(d?.kilos, 'kilos'),
    price_per_kg:
      d?.price_per_kg === undefined || d?.price_per_kg === null || d?.price_per_kg === ''
        ? null
        : normalizeNonNegative(d?.price_per_kg, 'price_per_kg'),
  }));

  const ids = normalized.map((d) => d.caliber_id);
  if (ids.some((id) => !id)) {
    const err = new Error('Cada detalle debe incluir caliber_id.');
    err.status = 400;
    throw err;
  }
  const uniq = new Set(ids);
  if (uniq.size !== ids.length) {
    const err = new Error('No se permiten calibres repetidos en un mismo registro.');
    err.status = 400;
    throw err;
  }

  const allowedLegacyIds = Array.isArray(allowInactiveCaliberIds) ? allowInactiveCaliberIds : [];
  const res = await db.query(
    `SELECT id
     FROM calibers
     WHERE id = ANY($1::uuid[])
       AND client_id = $2
       AND (
         is_active = true
         OR id = ANY($3::uuid[])
       )`,
    [ids, clientId, allowedLegacyIds]
  );
  if (res.rows.length !== ids.length) {
    const err = new Error('Uno o más calibres no existen o están inactivos.');
    err.status = 409;
    throw err;
  }

  return normalized;
}

async function assertNoDuplicateActiveProduction({
  db,
  clientId,
  scope,
  lotId,
  farmId,
  prodDate,
  excludeId = null,
}) {
  const res = await db.query(
    `SELECT id
     FROM lot_production
     WHERE client_id = $1
       AND is_active = true
       AND prod_date = $2
       AND cost_scope = $3
       AND (
         ($3 = 'lot' AND lot_id = $4 AND farm_id IS NULL)
         OR ($3 = 'farm' AND farm_id = $5 AND lot_id IS NULL)
       )
       AND ($6::uuid IS NULL OR id <> $6::uuid)
     LIMIT 1`,
    [clientId, prodDate, scope, lotId || null, farmId || null, excludeId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe una producción activa con la misma combinación.');
    err.status = 409;
    throw err;
  }
}

async function replaceAllocations({ db, productionId, clientId, allocations }) {
  await db.query(
    `DELETE FROM lot_production_allocations a
     WHERE a.lot_production_id = $1
       AND EXISTS (
         SELECT 1 FROM lot_production lp
         WHERE lp.id = a.lot_production_id AND lp.client_id = $2
       )`,
    [productionId, clientId]
  );
  if (!allocations || !allocations.length) return;
  for (const a of allocations) {
    await db.query(
      `INSERT INTO lot_production_allocations (
         lot_production_id, lot_id, allocation_pct, is_active, created_at, updated_at
       )
       VALUES ($1, $2, $3, true, NOW(), NOW())`,
      [productionId, a.lot_id, Number(a.allocation_pct)]
    );
  }
}

async function replaceDetails({ db, productionId, clientId, details }) {
  await db.query(
    `DELETE FROM lot_production_details d
     WHERE d.lot_production_id = $1
       AND EXISTS (
         SELECT 1 FROM lot_production lp
         WHERE lp.id = d.lot_production_id AND lp.client_id = $2
       )`,
    [productionId, clientId]
  );
  for (const d of details) {
    await db.query(
      `INSERT INTO lot_production_details (lot_production_id, caliber_id, kilos, price_per_kg, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [productionId, d.caliber_id, d.kilos, d.price_per_kg]
    );
  }
}

async function getByIdTx({ db, id, clientId }) {
  const headRes = await db.query(
    `SELECT lp.id, lp.cost_scope, lp.lot_id, lp.farm_id, lp.prod_date, lp.notes, lp.is_active,
            lp.created_at, lp.updated_at, l.name AS lot_name, f.name AS farm_name
     FROM lot_production lp
     LEFT JOIN lots l ON l.id = lp.lot_id AND l.client_id = $2
     LEFT JOIN farms f ON f.id = lp.farm_id AND f.client_id = $2
     WHERE lp.id = $1
       AND lp.client_id = $2`,
    [id, clientId]
  );
  const row = headRes.rows[0];
  if (!row) return null;

  const detailsRes = await db.query(
    `SELECT d.id, d.caliber_id, c.name AS caliber_name, d.kilos, d.price_per_kg, d.total_amount
     FROM lot_production_details d
     JOIN calibers c ON c.id = d.caliber_id AND c.client_id = $2
     WHERE d.lot_production_id = $1
     ORDER BY c.name ASC`,
    [id, clientId]
  );

  const allocRes = await db.query(
    `SELECT a.lot_id, l.name AS lot_name, a.allocation_pct
     FROM lot_production_allocations a
     JOIN lots l ON l.id = a.lot_id AND l.client_id = $2
     WHERE a.lot_production_id = $1
       AND a.is_active = true
     ORDER BY l.name ASC`,
    [id, clientId]
  );

  return { ...row, details: detailsRes.rows, allocations: allocRes.rows };
}

async function createProductionTx({ db, clientId, userId, payload }) {
  const scope = normalizeScope(payload.cost_scope, { required: true });
  const lotId = normalizeText(payload.lot_id);
  const farmId = normalizeText(payload.farm_id);
  const prodDate = normalizeDate(payload.prod_date, { required: true });
  const notes = normalizeText(payload.notes);

  assertScopeReferences({ scope, lotId, farmId });
  const entities = await validateScopeEntities({ db, scope, lotId, farmId, clientId });
  await assertNoDuplicateActiveProduction({ db, clientId, scope, lotId, farmId, prodDate });
  const details = await validateDetails({ db, details: payload.details, clientId });

  const insertRes = await db.query(
    `INSERT INTO lot_production (
       lot_id, farm_id, cost_scope, prod_date, notes, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     RETURNING id`,
    [scope === 'lot' ? lotId : null, scope === 'farm' ? farmId : null, scope, prodDate, notes, clientId, userId]
  );
  const productionId = insertRes.rows[0].id;

  await replaceDetails({ db, productionId, clientId, details });

  if (scope === 'farm') {
    const allocations = await allocationsService.resolveFarmAllocations({
      db,
      farmId,
      clientId,
      laborAllocationMode: entities.farm.labor_allocation_mode,
      allocations: payload.allocations,
    });
    await replaceAllocations({ db, productionId, clientId, allocations });
  }

  return getByIdTx({ db, id: productionId, clientId });
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

async function listProductions({ clientId, filters }) {
  const q = filters || {};
  const clauses = ['lp.client_id = $1'];
  const values = [clientId];
  let idx = 2;

  if (q.fromDate) {
    clauses.push(`lp.prod_date >= $${idx++}`);
    values.push(q.fromDate);
  }
  if (q.toDate) {
    clauses.push(`lp.prod_date <= $${idx++}`);
    values.push(q.toDate);
  }
  if (q.scope) {
    clauses.push(`lp.cost_scope = $${idx++}`);
    values.push(q.scope);
  }
  if (q.farmId) {
    clauses.push(`lp.farm_id = $${idx++}`);
    values.push(q.farmId);
  }
  if (q.lotId) {
    clauses.push(`lp.lot_id = $${idx++}`);
    values.push(q.lotId);
  }
  if (q.active !== undefined) {
    clauses.push(`lp.is_active = $${idx++}`);
    values.push(q.active);
  }

  const res = await pool.query(
    `SELECT lp.id, lp.cost_scope, lp.lot_id, lp.farm_id, lp.prod_date, lp.notes, lp.is_active,
            lp.created_at, lp.updated_at, l.name AS lot_name, f.name AS farm_name,
            COALESCE(SUM(d.kilos), 0)::numeric(14,2) AS total_kilos,
            COALESCE(SUM(d.total_amount), 0)::numeric(14,2) AS total_amount
     FROM lot_production lp
     LEFT JOIN lot_production_details d ON d.lot_production_id = lp.id
     LEFT JOIN lots l ON l.id = lp.lot_id AND l.client_id = lp.client_id
     LEFT JOIN farms f ON f.id = lp.farm_id AND f.client_id = lp.client_id
     WHERE ${clauses.join(' AND ')}
     GROUP BY lp.id, l.name, f.name
     ORDER BY lp.prod_date DESC, lp.created_at DESC`,
    values
  );
  return res.rows;
}

async function getProductionById({ id, clientId }) {
  const db = await pool.connect();
  try {
    return await getByIdTx({ db, id, clientId });
  } finally {
    db.release();
  }
}

async function createProduction({ clientId, userId, payload }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const created = await createProductionTx({ db, clientId, userId, payload });
    await db.query('COMMIT');
    return created;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function createProductionsBulk({ clientId, userId, payload }) {
  const fromDate = normalizeDate(payload.from_date, { required: true, field: 'from_date' });
  const toDate = normalizeDate(payload.to_date, { required: true, field: 'to_date' });
  const dates = buildDateRange(fromDate, toDate);
  const dailyItems = Array.isArray(payload.daily_items) ? payload.daily_items : null;
  let detailsByDate = null;
  if (dailyItems && dailyItems.length > 0) {
    detailsByDate = new Map();
    for (const item of dailyItems) {
      const d = normalizeDate(item?.prod_date, { required: true, field: 'daily_items.prod_date' });
      detailsByDate.set(d, item?.details);
    }
    for (const d of dates) {
      if (!detailsByDate.has(d)) {
        const err = new Error(`Faltan detalles para la fecha ${d} en daily_items.`);
        err.status = 400;
        throw err;
      }
    }
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = [];
    for (const date of dates) {
      const row = await createProductionTx({
        db,
        clientId,
        userId,
        payload: {
          ...payload,
          prod_date: date,
          details: detailsByDate ? detailsByDate.get(date) : payload.details,
        },
      });
      out.push(row);
    }
    await db.query('COMMIT');
    return out;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function updateProduction({ id, clientId, userId, payload }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(`SELECT * FROM lot_production WHERE id = $1 AND client_id = $2`, [id, clientId]);
    const current = curRes.rows[0];
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }

    const scope =
      payload.cost_scope !== undefined
        ? normalizeScope(payload.cost_scope, { required: true })
        : current.cost_scope;
    const lotId = payload.lot_id !== undefined ? normalizeText(payload.lot_id) : current.lot_id;
    const farmId = payload.farm_id !== undefined ? normalizeText(payload.farm_id) : current.farm_id;
    const prodDate =
      payload.prod_date !== undefined
        ? normalizeDate(payload.prod_date, { required: true })
        : toIsoDate(current.prod_date);
    const notes = payload.notes !== undefined ? normalizeText(payload.notes) : current.notes;

    assertScopeReferences({ scope, lotId, farmId });
    const entities = await validateScopeEntities({ db, scope, lotId, farmId, clientId });
    if (current.is_active) {
      await assertNoDuplicateActiveProduction({
        db,
        clientId,
        scope,
        lotId,
        farmId,
        prodDate,
        excludeId: id,
      });
    }

    await db.query(
      `UPDATE lot_production
       SET lot_id = $2,
           farm_id = $3,
           cost_scope = $4,
           prod_date = $5,
           notes = $6,
           updated_by_user_id = $7,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $8`,
      [id, scope === 'lot' ? lotId : null, scope === 'farm' ? farmId : null, scope, prodDate, notes, userId, clientId]
    );

    if (payload.details !== undefined) {
      const existingDetailsRes = await db.query(
        `SELECT d.caliber_id
         FROM lot_production_details d
         WHERE d.lot_production_id = $1
           AND EXISTS (
             SELECT 1 FROM lot_production lp
             WHERE lp.id = d.lot_production_id AND lp.client_id = $2
           )`,
        [id, clientId]
      );
      const existingCaliberIds = existingDetailsRes.rows.map((r) => r.caliber_id);
      const details = await validateDetails({
        db,
        details: payload.details,
        clientId,
        allowInactiveCaliberIds: existingCaliberIds,
      });
      await replaceDetails({ db, productionId: id, clientId, details });
    }

    if (scope === 'farm') {
      const allocations = await allocationsService.resolveFarmAllocations({
        db,
        farmId,
        clientId,
        laborAllocationMode: entities.farm.labor_allocation_mode,
        allocations: payload.allocations,
      });
      await replaceAllocations({ db, productionId: id, clientId, allocations });
    } else {
      await replaceAllocations({ db, productionId: id, clientId, allocations: [] });
    }

    const updated = await getByIdTx({ db, id, clientId });
    await db.query('COMMIT');
    return updated;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function setProductionActive({ id, clientId, userId, isActive }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(`SELECT * FROM lot_production WHERE id = $1 AND client_id = $2`, [id, clientId]);
    const current = curRes.rows[0];
    if (!current) {
      await db.query('ROLLBACK');
      return null;
    }

    const normalizedScope =
      current.cost_scope || (current.lot_id ? 'lot' : current.farm_id ? 'farm' : null);
    const normalizedLotId = normalizedScope === 'lot' ? current.lot_id : null;
    const normalizedFarmId = normalizedScope === 'farm' ? current.farm_id : null;

    if (!normalizedScope) {
      const err = new Error(
        'No se pudo determinar el scope del registro. Edita el registro para definir finca/lote.'
      );
      err.status = 409;
      throw err;
    }

    // Defensive validation/normalization for legacy rows before toggling active state.
    await validateScopeEntities({
      db,
      scope: normalizedScope,
      lotId: normalizedLotId,
      farmId: normalizedFarmId,
      clientId,
    });

    if (isActive) {
      await assertNoDuplicateActiveProduction({
        db,
        clientId,
        scope: normalizedScope,
        lotId: normalizedLotId,
        farmId: normalizedFarmId,
        prodDate: toIsoDate(current.prod_date),
        excludeId: id,
      });
    }

    await db.query(
      `UPDATE lot_production
       SET cost_scope = $2,
           lot_id = $3,
           farm_id = $4,
           is_active = $5,
           updated_by_user_id = $6,
           updated_at = NOW()
       WHERE id = $1
         AND client_id = $7`,
      [id, normalizedScope, normalizedLotId, normalizedFarmId, !!isActive, userId, clientId]
    );
    const row = await getByIdTx({ db, id, clientId });
    await db.query('COMMIT');
    return row;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function getSummaryByLot({ clientId, fromDate, toDate, farmId, lotId }) {
  const clauses = ['lp.is_active = true', 'lp.client_id = $1'];
  const values = [clientId];
  let idx = 2;
  if (fromDate) {
    clauses.push(`lp.prod_date >= $${idx++}`);
    values.push(fromDate);
  }
  if (toDate) {
    clauses.push(`lp.prod_date <= $${idx++}`);
    values.push(toDate);
  }
  if (farmId) {
    const p = idx++;
    clauses.push(`(lp.farm_id = $${p} OR l.farm_id = $${p})`);
    values.push(farmId);
  }
  if (lotId) {
    clauses.push(`COALESCE(a.lot_id, lp.lot_id) = $${idx++}`);
    values.push(lotId);
  }

  const res = await pool.query(
    `SELECT COALESCE(a.lot_id, lp.lot_id) AS lot_id,
            COALESCE(l2.name, l.name) AS lot_name,
            SUM(
              CASE
                WHEN lp.cost_scope = 'farm' THEN d.kilos * (COALESCE(a.allocation_pct, 0) / 100.0)
                ELSE d.kilos
              END
            )::numeric(14,2) AS total_kilos,
            SUM(
              CASE
                WHEN d.total_amount IS NULL THEN 0
                WHEN lp.cost_scope = 'farm' THEN d.total_amount * (COALESCE(a.allocation_pct, 0) / 100.0)
                ELSE d.total_amount
              END
            )::numeric(14,2) AS total_amount
     FROM lot_production lp
     JOIN lot_production_details d ON d.lot_production_id = lp.id
     LEFT JOIN lot_production_allocations a
       ON a.lot_production_id = lp.id AND a.is_active = true
     LEFT JOIN lots l ON l.id = lp.lot_id AND l.client_id = $1
     LEFT JOIN lots l2 ON l2.id = a.lot_id AND l2.client_id = $1
     WHERE ${clauses.join(' AND ')}
     GROUP BY COALESCE(a.lot_id, lp.lot_id), COALESCE(l2.name, l.name)
     ORDER BY lot_name ASC`,
    values
  );
  return res.rows;
}

async function getMeta({ clientId }) {
  const [farms, lots, calibers] = await Promise.all([
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
      `SELECT id, name
       FROM calibers
       WHERE is_active = true
         AND client_id = $1
       ORDER BY name ASC`,
      [clientId]
    ),
  ]);

  return { farms: farms.rows, lots: lots.rows, calibers: calibers.rows };
}

module.exports = {
  listProductions,
  getProductionById,
  createProduction,
  createProductionsBulk,
  updateProduction,
  setProductionActive,
  getSummaryByLot,
  getMeta,
};

