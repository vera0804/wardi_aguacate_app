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

async function assertUniqueName({ clientId, name, excludeId = null }) {
  const res = await pool.query(
    `SELECT id
     FROM calibers
     WHERE client_id = $1
       AND lower(trim(name)) = lower(trim($2))
       AND ($3::uuid IS NULL OR id <> $3::uuid)
     LIMIT 1`,
    [clientId, name, excludeId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe un calibre con ese nombre.');
    err.status = 409;
    throw err;
  }
}

async function listCalibers({ clientId, includeInactive = false, search = '' } = {}) {
  const term = String(search || '').trim().toLowerCase();
  const like = term ? `%${term}%` : null;
  const res = await pool.query(
    `SELECT id, name, description, is_active
     FROM calibers
     WHERE client_id = $1
       AND ($2::boolean = true OR is_active = true)
       AND (
         $3::text IS NULL
         OR lower(name) LIKE $3
         OR lower(COALESCE(description, '')) LIKE $3
       )
     ORDER BY is_active DESC, name ASC`,
    [clientId, includeInactive, like]
  );
  return res.rows;
}

async function getCaliberById({ id, clientId }) {
  const res = await pool.query(
    `SELECT id, name, description, is_active
     FROM calibers
     WHERE id = $1
       AND client_id = $2`,
    [id, clientId]
  );
  return res.rows[0] || null;
}

async function createCaliber({ clientId, name, description }) {
  const cleanName = normalizeText(name, { required: true, field: 'name', max: 50 });
  const cleanDescription = normalizeText(description, { max: 1000 });
  await assertUniqueName({ clientId, name: cleanName });
  const res = await pool.query(
    `INSERT INTO calibers (name, description, client_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, is_active`,
    [cleanName, cleanDescription, clientId]
  );
  return res.rows[0];
}

async function updateCaliber({ id, clientId, name, description }) {
  const current = await getCaliberById({ id, clientId });
  if (!current) return null;

  const fields = [];
  const values = [];
  let idx = 1;

  if (name !== undefined) {
    const cleanName = normalizeText(name, { required: true, field: 'name', max: 50 });
    await assertUniqueName({ clientId, name: cleanName, excludeId: id });
    fields.push(`name = $${idx++}`);
    values.push(cleanName);
  }

  if (description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(normalizeText(description, { max: 1000 }));
  }

  if (!fields.length) {
    const err = new Error('No hay cambios para actualizar.');
    err.status = 400;
    throw err;
  }

  values.push(id);
  values.push(clientId);
  const res = await pool.query(
    `UPDATE calibers
     SET ${fields.join(', ')}
     WHERE id = $${idx}
       AND client_id = $${idx + 1}
     RETURNING id, name, description, is_active`,
    values
  );
  return res.rows[0] || null;
}

async function setCaliberActive({ id, clientId, isActive }) {
  const res = await pool.query(
    `UPDATE calibers
     SET is_active = $2
     WHERE id = $1
       AND client_id = $3
     RETURNING id, name, description, is_active`,
    [id, !!isActive, clientId]
  );
  return res.rows[0] || null;
}

module.exports = {
  listCalibers,
  getCaliberById,
  createCaliber,
  updateCaliber,
  setCaliberActive,
};

