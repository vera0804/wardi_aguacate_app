const { pool } = require('../db');

/** Quita tildes y marcas combinantes (alineado con índice unaccent en BD). */
function foldDiacritics(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Primera letra mayúscula, resto minúsculas, sin tildes en el valor guardado. */
function formatCategoryNameStored(raw) {
  const t = foldDiacritics(String(raw ?? '').normalize('NFC').trim());
  if (!t) return '';
  const lower = t.toLocaleLowerCase('es');
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

function normalizeName(value, { required = false } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    if (required) {
      const err = new Error('El nombre es obligatorio.');
      err.status = 400;
      throw err;
    }
    return null;
  }
  const v = formatCategoryNameStored(trimmed);
  if (!v) {
    if (required) {
      const err = new Error('El nombre es obligatorio.');
      err.status = 400;
      throw err;
    }
    return null;
  }
  if (v.length > 100) {
    const err = new Error('El nombre no puede superar 100 caracteres.');
    err.status = 400;
    throw err;
  }
  return v;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    is_active: row.status === 'activo',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function throwDb(err) {
  if (err.code === '23505') {
    const e = new Error('Ya existe una categoría con ese nombre.');
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

async function listAssetCategories({ clientId, active }) {
  const values = [clientId];
  let sql = `SELECT id, name, status, created_at, updated_at
             FROM asset_categories WHERE client_id = $1`;
  if (active === true) sql += ` AND status = 'activo'`;
  else if (active === false) sql += ` AND status = 'inactivo'`;
  sql += ` ORDER BY name_norm ASC`;
  const res = await pool.query(sql, values);
  return res.rows.map(mapRow);
}

async function getAssetCategoryById({ id, clientId }) {
  const res = await pool.query(
    `SELECT id, name, status, created_at, updated_at
     FROM asset_categories WHERE id = $1 AND client_id = $2`,
    [id, clientId]
  );
  return mapRow(res.rows[0]);
}

async function createAssetCategory({ clientId, userId, body }) {
  const name = normalizeName(body?.name, { required: true });
  try {
    const res = await pool.query(
      `INSERT INTO asset_categories (name, status, client_id, created_by, updated_by)
       VALUES ($1, 'activo', $2, $3, $3)
       RETURNING id, name, status, created_at, updated_at`,
      [name, clientId, userId]
    );
    return mapRow(res.rows[0]);
  } catch (e) {
    throwDb(e);
  }
}

async function updateAssetCategory({ id, clientId, userId, body }) {
  const name = body.name !== undefined ? normalizeName(body.name, { required: true }) : undefined;
  if (name === undefined) {
    const err = new Error('No hay campos para actualizar.');
    err.status = 400;
    throw err;
  }
  try {
    const res = await pool.query(
      `UPDATE asset_categories
       SET name = $1, updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND client_id = $4
       RETURNING id, name, status, created_at, updated_at`,
      [name, userId, id, clientId]
    );
    if (!res.rows[0]) return null;
    return mapRow(res.rows[0]);
  } catch (e) {
    throwDb(e);
  }
}

async function setAssetCategoryActive({ id, clientId, userId, isActive }) {
  const status = isActive ? 'activo' : 'inactivo';
  const res = await pool.query(
    `UPDATE asset_categories
     SET status = $1::varchar, updated_by = $2, updated_at = NOW()
     WHERE id = $3 AND client_id = $4
     RETURNING id, name, status, created_at, updated_at`,
    [status, userId, id, clientId]
  );
  if (!res.rows[0]) return null;
  return mapRow(res.rows[0]);
}

module.exports = {
  parseActiveQuery,
  listAssetCategories,
  getAssetCategoryById,
  createAssetCategory,
  updateAssetCategory,
  setAssetCategoryActive,
};
