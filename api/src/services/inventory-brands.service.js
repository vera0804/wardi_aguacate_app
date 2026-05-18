const { pool } = require('../db');

function normalizeText(value, { required = false, field = 'campo', max = null } = {}) {
  if (value == null) {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  const v = String(value).trim();
  if (!v) {
    if (required) {
      const err = new Error(`El campo ${field} es obligatorio.`);
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (max && v.length > max) {
    const err = new Error(`El campo ${field} no puede superar ${max} caracteres.`);
    err.status = 400;
    throw err;
  }
  return v;
}

async function assertUniqueBrandName({ clientId, name, excludeId = null }) {
  const res = await pool.query(
    `SELECT id
     FROM inventory_brands
     WHERE client_id = $1
       AND lower(trim(name)) = lower(trim($2))
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [clientId, name, excludeId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe una marca con ese nombre.');
    err.status = 409;
    throw err;
  }
}

async function listInventoryBrands({ clientId, active = 'all', search = '' } = {}) {
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const like = normalizedSearch ? `%${normalizedSearch}%` : null;
  const normalizedActive = String(active || 'all').toLowerCase();
  const activeFilter =
    normalizedActive === 'true' ? true : normalizedActive === 'false' ? false : 'all';
  const res = await pool.query(
    `SELECT id, name, is_active, client_id, created_at, updated_at
     FROM inventory_brands
     WHERE client_id = $1
       AND ($2::text = 'all' OR is_active = $2::boolean)
       AND ($3::text IS NULL OR lower(name) LIKE $3)
     ORDER BY is_active DESC, name ASC`,
    [clientId, activeFilter, like]
  );
  return res.rows;
}

async function getBrandById({ id, clientId }) {
  const res = await pool.query(
    `SELECT id, name, is_active, client_id, created_at, updated_at
     FROM inventory_brands
     WHERE id = $1
       AND client_id = $2`,
    [id, clientId]
  );
  return res.rows[0] || null;
}

async function createInventoryBrand({ clientId, userId, name }) {
  const cleanName = normalizeText(name, { required: true, field: 'name', max: 100 });
  await assertUniqueBrandName({ clientId, name: cleanName });
  const res = await pool.query(
    `INSERT INTO inventory_brands (name, client_id, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $3)
     RETURNING id, name, is_active, client_id, created_at, updated_at`,
    [cleanName, clientId, userId]
  );
  return res.rows[0] || null;
}

async function updateInventoryBrand({ clientId, id, userId, name }) {
  const current = await getBrandById({ id, clientId });
  if (!current) return null;
  const cleanName = normalizeText(name, { required: true, field: 'name', max: 100 });
  await assertUniqueBrandName({ clientId, name: cleanName, excludeId: id });
  const res = await pool.query(
    `UPDATE inventory_brands
     SET name = $3,
         updated_by_user_id = $4,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $2
     RETURNING id, name, is_active, client_id, created_at, updated_at`,
    [id, clientId, cleanName, userId]
  );
  return res.rows[0] || null;
}

async function setInventoryBrandActive({ clientId, id, userId, isActive }) {
  const res = await pool.query(
    `UPDATE inventory_brands
     SET is_active = $4,
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $2
     RETURNING id, name, is_active, client_id, created_at, updated_at`,
    [id, clientId, userId, !!isActive]
  );
  return res.rows[0] || null;
}

module.exports = {
  listInventoryBrands,
  getBrandById,
  createInventoryBrand,
  updateInventoryBrand,
  setInventoryBrandActive,
};
