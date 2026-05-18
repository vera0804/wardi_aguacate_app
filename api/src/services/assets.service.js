const { pool } = require('../db');

const DISPOSITION_REASONS = new Set(['venta', 'donacion', 'perdida']);

function normalizeText(value, { max = null } = {}) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (max && v.length > max) {
    const err = new Error(`Texto demasiado largo (máx. ${max}).`);
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeDate(value, { required = false, field = 'purchase_date' } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const err = new Error(`${field} debe ser YYYY-MM-DD.`);
    err.status = 400;
    throw err;
  }
  return v;
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function throwDb(err) {
  if (err.code === '23505') {
    const e = new Error('Conflicto de datos duplicados (placa u otro campo único).');
    e.status = 409;
    throw e;
  }
  if (err.code === '23503') {
    const e = new Error('Referencia inválida (categoría u otro dato relacionado).');
    e.status = 409;
    throw e;
  }
  throw err;
}

function parseActiveQuery(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  const err = new Error('El parámetro active debe ser true o false.');
  err.status = 400;
  throw err;
}

const BASE_SELECT = `
  SELECT a.id, a.category_id, a.name, a.alias, a.brand, a.model, a.plate, a.purchase_date,
         a.purchase_cost, a.purchase_cost_usd, a.useful_life_years, a.salvage_value, a.observations,
         a.status, a.disposition_reason, a.disposition_date, a.disposition_notes,
         a.created_at, a.updated_at,
         COALESCE(ac.name, '—') AS category_name
  FROM assets a
  LEFT JOIN asset_categories ac ON ac.id = a.category_id AND ac.client_id = a.client_id
`;

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    category_id: row.category_id,
    category_name: row.category_name,
    name: row.name,
    alias: row.alias,
    brand: row.brand,
    model: row.model,
    plate: row.plate,
    purchase_date: row.purchase_date,
    purchase_cost: row.purchase_cost != null ? Number(row.purchase_cost) : null,
    purchase_cost_usd: row.purchase_cost_usd != null ? Number(row.purchase_cost_usd) : null,
    useful_life_years: row.useful_life_years,
    salvage_value: row.salvage_value != null ? Number(row.salvage_value) : null,
    observations: row.observations,
    status: row.status,
    is_active: row.status === 'activo',
    disposition_reason: row.disposition_reason,
    disposition_date: row.disposition_date,
    disposition_notes: row.disposition_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function assertCategoryForClient({ db, categoryId, clientId }) {
  const conn = db || pool;
  const r = await conn.query(
    `SELECT id FROM asset_categories WHERE id = $1 AND client_id = $2 AND status = 'activo'`,
    [categoryId, clientId]
  );
  if (!r.rows[0]) {
    const err = new Error('Categoría no encontrada o inactiva.');
    err.status = 400;
    throw err;
  }
}

function resolvePurchaseCosts(body) {
  const cur = String(body.purchase_currency || 'CRC')
    .trim()
    .toUpperCase();
  if (cur !== 'CRC' && cur !== 'USD') {
    const err = new Error("purchase_currency debe ser 'CRC' o 'USD'.");
    err.status = 400;
    throw err;
  }
  if (cur === 'CRC') {
    const cost = Number(body.purchase_cost);
    if (!Number.isFinite(cost) || cost < 0) {
      const err = new Error('purchase_cost inválido (CRC).');
      err.status = 400;
      throw err;
    }
    return { purchase_cost: round2(cost), purchase_cost_usd: null };
  }
  const usd = Number(body.purchase_cost_usd);
  let fx = Number(body.fx_rate);
  if (!Number.isFinite(usd) || usd < 0) {
    const err = new Error('purchase_cost_usd inválido.');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(fx) || fx <= 0) {
    const pc = Number(body.purchase_cost);
    if (Number.isFinite(pc) && pc > 0 && usd > 0) {
      fx = pc / usd;
    }
  }
  if (!Number.isFinite(fx) || fx <= 0) {
    const err = new Error('fx_rate es obligatorio y debe ser mayor que 0 cuando la moneda es USD.');
    err.status = 400;
    throw err;
  }
  const crc = round2(usd * fx);
  return { purchase_cost: crc, purchase_cost_usd: round2(usd) };
}

async function inactivateFutureDepreciation({ db, assetId, clientId, userId, dispositionDate }) {
  const y = dispositionDate.getFullYear();
  const m = dispositionDate.getMonth() + 1;
  const cutoff = y * 12 + m;
  await db.query(
    `UPDATE asset_depreciation
     SET status = 'inactivo', updated_by = $1, updated_at = NOW()
     WHERE asset_id = $2 AND client_id = $3
       AND (period_year * 12 + period_month) > $4`,
    [userId, assetId, clientId, cutoff]
  );
}

async function listAssets({ clientId, active, categoryId, q }) {
  let activeFilter;
  if (active === undefined || active === null) {
    activeFilter = undefined;
  } else if (typeof active === 'boolean') {
    activeFilter = active;
  } else if (String(active).trim() === '') {
    activeFilter = undefined;
  } else {
    activeFilter = parseActiveQuery(active);
  }

  if (categoryId) {
    const ok = await pool.query(`SELECT 1 FROM asset_categories WHERE id = $1 AND client_id = $2`, [
      categoryId,
      clientId,
    ]);
    if (!ok.rows[0]) {
      const err = new Error('Categoría no válida para tu organización.');
      err.status = 400;
      throw err;
    }
  }
  const values = [clientId];
  let where = 'WHERE a.client_id = $1';
  if (activeFilter === true) where += ` AND a.status = 'activo'`;
  else if (activeFilter === false) where += ` AND a.status = 'inactivo'`;
  if (categoryId) {
    values.push(categoryId);
    where += ` AND a.category_id = $${values.length}`;
  }
  if (q) {
    values.push(`%${String(q).trim()}%`);
    const i = values.length;
    where += ` AND (
      a.name ILIKE $${i} OR COALESCE(a.alias,'') ILIKE $${i}
      OR COALESCE(a.brand,'') ILIKE $${i} OR COALESCE(a.model,'') ILIKE $${i}
      OR a.plate ILIKE $${i} OR COALESCE(a.observations,'') ILIKE $${i}
    )`;
  }
  const sql = `${BASE_SELECT} ${where} ORDER BY a.plate ASC, a.name ASC`;
  const res = await pool.query(sql, values);
  return res.rows.map(mapAsset);
}

async function getAssetById({ id, clientId }) {
  const res = await pool.query(`${BASE_SELECT} WHERE a.id = $1 AND a.client_id = $2`, [id, clientId]);
  return mapAsset(res.rows[0]);
}

async function createAsset({ clientId, userId, body }) {
  const name = normalizeText(body.name, { max: 150 });
  if (!name) {
    const err = new Error('El nombre es obligatorio.');
    err.status = 400;
    throw err;
  }
  const categoryId = normalizeText(body.category_id);
  if (!categoryId) {
    const err = new Error('category_id es obligatorio.');
    err.status = 400;
    throw err;
  }
  const purchaseDate = normalizeDate(body.purchase_date, { required: true });
  const usefulLifeYears = Number(body.useful_life_years);
  if (!Number.isInteger(usefulLifeYears) || usefulLifeYears <= 0) {
    const err = new Error('useful_life_years debe ser un entero mayor que 0.');
    err.status = 400;
    throw err;
  }
  const salvage = Number(body.salvage_value ?? 0);
  if (!Number.isFinite(salvage) || salvage < 0) {
    const err = new Error('salvage_value inválido.');
    err.status = 400;
    throw err;
  }
  const { purchase_cost, purchase_cost_usd } = resolvePurchaseCosts(body);
  if (salvage > purchase_cost) {
    const err = new Error('El valor residual no puede superar el costo de compra en colones.');
    err.status = 400;
    throw err;
  }
  const alias = normalizeText(body.alias, { max: 100 });
  const brand = normalizeText(body.brand, { max: 100 });
  const model = normalizeText(body.model, { max: 100 });
  const plateRaw = body.plate !== undefined && body.plate !== null ? String(body.plate).trim() : null;
  const plate = plateRaw || null;
  const observations = body.observations != null ? String(body.observations).trim() || null : null;

  await assertCategoryForClient({ categoryId, clientId });

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const ins = await db.query(
      `INSERT INTO assets (
         category_id, alias, brand, model, name, purchase_date, purchase_cost, purchase_cost_usd,
         useful_life_years, salvage_value, observations, status, plate, client_id, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,'activo',$12,$13,$14,$14)
       RETURNING id`,
      [
        categoryId,
        alias,
        brand,
        model,
        name,
        purchaseDate,
        purchase_cost,
        purchase_cost_usd,
        usefulLifeYears,
        salvage,
        observations,
        plate,
        clientId,
        userId,
      ]
    );
    const id = ins.rows[0].id;
    const sel = await db.query(`${BASE_SELECT} WHERE a.id = $1 AND a.client_id = $2`, [id, clientId]);
    await db.query('COMMIT');
    return mapAsset(sel.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    throwDb(e);
  } finally {
    db.release();
  }
}

async function updateAsset({ id, clientId, userId, body }) {
  const curRes = await pool.query(`SELECT * FROM assets WHERE id = $1 AND client_id = $2`, [id, clientId]);
  const cur = curRes.rows[0];
  if (!cur) return null;

  let categoryId = body.category_id !== undefined ? normalizeText(body.category_id) : cur.category_id;
  let name = body.name !== undefined ? normalizeText(body.name, { max: 150 }) : cur.name;
  if (body.name !== undefined && !name) {
    const err = new Error('El nombre no puede quedar vacío.');
    err.status = 400;
    throw err;
  }
  let alias = body.alias !== undefined ? normalizeText(body.alias, { max: 100 }) : cur.alias;
  let brand = body.brand !== undefined ? normalizeText(body.brand, { max: 100 }) : cur.brand;
  let model = body.model !== undefined ? normalizeText(body.model, { max: 100 }) : cur.model;
  let plate =
    body.plate !== undefined
      ? (() => {
          const p = String(body.plate || '').trim();
          return p || null;
        })()
      : cur.plate;
  let purchaseDate =
    body.purchase_date !== undefined ? normalizeDate(body.purchase_date, { required: true }) : cur.purchase_date;
  let usefulLifeYears =
    body.useful_life_years !== undefined ? Number(body.useful_life_years) : cur.useful_life_years;
  if (body.useful_life_years !== undefined) {
    if (!Number.isInteger(usefulLifeYears) || usefulLifeYears <= 0) {
      const err = new Error('useful_life_years debe ser un entero mayor que 0.');
      err.status = 400;
      throw err;
    }
  }
  let salvage = body.salvage_value !== undefined ? Number(body.salvage_value) : Number(cur.salvage_value);
  if (body.salvage_value !== undefined && (!Number.isFinite(salvage) || salvage < 0)) {
    const err = new Error('salvage_value inválido.');
    err.status = 400;
    throw err;
  }
  let purchaseCost = cur.purchase_cost != null ? Number(cur.purchase_cost) : null;
  let purchaseCostUsd =
    cur.purchase_cost_usd != null ? Number(cur.purchase_cost_usd) : null;

  const hasProp = (k) => Object.prototype.hasOwnProperty.call(body || {}, k);
  const touchesCost =
    hasProp('purchase_currency') ||
    hasProp('purchase_cost') ||
    hasProp('purchase_cost_usd') ||
    hasProp('fx_rate');

  if (touchesCost) {
    const merged = {
      purchase_currency: body.purchase_currency ?? (purchaseCostUsd != null ? 'USD' : 'CRC'),
      purchase_cost: hasProp('purchase_cost') ? body.purchase_cost : purchaseCost,
      purchase_cost_usd: hasProp('purchase_cost_usd') ? body.purchase_cost_usd : purchaseCostUsd,
      fx_rate: body.fx_rate,
    };
    const resolved = resolvePurchaseCosts(merged);
    purchaseCost = resolved.purchase_cost;
    purchaseCostUsd = resolved.purchase_cost_usd;
  }

  if (salvage > purchaseCost) {
    const err = new Error('El valor residual no puede superar el costo de compra en colones.');
    err.status = 400;
    throw err;
  }

  let observations =
    body.observations !== undefined
      ? body.observations == null
        ? null
        : String(body.observations).trim() || null
      : cur.observations;

  await assertCategoryForClient({ categoryId, clientId });

  const db = await pool.connect();
  try {
    await db.query(
      `UPDATE assets SET
         category_id = $1, name = $2, alias = $3, brand = $4, model = $5, plate = $6,
         purchase_date = $7::date, purchase_cost = $8, purchase_cost_usd = $9,
         useful_life_years = $10, salvage_value = $11, observations = $12,
         updated_by = $13, updated_at = NOW()
       WHERE id = $14 AND client_id = $15`,
      [
        categoryId,
        name,
        alias,
        brand,
        model,
        plate,
        purchaseDate,
        purchaseCost,
        purchaseCostUsd,
        usefulLifeYears,
        salvage,
        observations,
        userId,
        id,
        clientId,
      ]
    );
    const sel = await db.query(`${BASE_SELECT} WHERE a.id = $1 AND a.client_id = $2`, [id, clientId]);
    return mapAsset(sel.rows[0]);
  } catch (e) {
    throwDb(e);
  } finally {
    db.release();
  }
}

async function setAssetActive({ id, clientId, userId, isActive, body }) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(`SELECT id, status FROM assets WHERE id = $1 AND client_id = $2`, [
      id,
      clientId,
    ]);
    const cur = curRes.rows[0];
    if (!cur) {
      await db.query('ROLLBACK');
      return null;
    }

    if (isActive) {
      await db.query(
        `UPDATE assets SET
           status = 'activo',
           disposition_reason = NULL,
           disposition_date = NULL,
           disposition_notes = NULL,
           updated_by = $1, updated_at = NOW()
         WHERE id = $2 AND client_id = $3`,
        [userId, id, clientId]
      );
      await db.query('COMMIT');
      return getAssetById({ id, clientId });
    }

    const reason = String(body?.disposition_reason || '')
      .trim()
      .toLowerCase();
    if (!DISPOSITION_REASONS.has(reason)) {
      const err = new Error('disposition_reason es obligatorio al inactivar: venta, donacion o perdida.');
      err.status = 400;
      throw err;
    }
    const dispDateStr = normalizeDate(body?.disposition_date, { required: true, field: 'disposition_date' });
    const dispDate = new Date(`${dispDateStr}T12:00:00`);
    const dispNotes = body?.disposition_notes != null ? String(body.disposition_notes).trim() || null : null;

    await db.query(
      `UPDATE assets SET
         status = 'inactivo',
         disposition_reason = $1,
         disposition_date = $2::date,
         disposition_notes = $3,
         updated_by = $4, updated_at = NOW()
       WHERE id = $5 AND client_id = $6`,
      [reason, dispDateStr, dispNotes, userId, id, clientId]
    );

    /**
     * Contablemente: al dar de baja (venta, donación o pérdida) no corresponde seguir depreciando
     * periodos posteriores a la fecha de baja. Los meses ya registrados se conservan;
     * la depreciación futura programada pasa a inactiva para no seguir contabilizando en automático.
     */
    await inactivateFutureDepreciation({
      db,
      assetId: id,
      clientId,
      userId,
      dispositionDate: dispDate,
    });

    await db.query('COMMIT');
    return getAssetById({ id, clientId });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  parseActiveQuery,
  listAssets,
  getAssetById,
  createAsset,
  updateAsset,
  setAssetActive,
  DISPOSITION_REASONS,
};
