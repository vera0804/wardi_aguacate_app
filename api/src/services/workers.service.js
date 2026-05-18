const { pool } = require('../db');

/** Valores que pueden existir en BD (incluye legado). */
const DB_WORKER_TYPES = new Set(['fijo', 'ocasional', 'recolector']);
/** Valores que el software permite asignar al crear o al cambiar tipo. */
const ASSIGNABLE_WORKER_TYPES = new Set(['fijo', 'ocasional']);
const VALID_ID_TYPES = new Set(['nacional', 'extranjero']);
const PHONE_ALLOWED_REGEX = /^[0-9+\-() ]+$/;

function normalizeText(value, { required = false, field = 'campo' } = {}) {
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
  return v;
}

function normalizeWorkerType(value, { required = false, assignableOnly = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  const allowed = assignableOnly ? ASSIGNABLE_WORKER_TYPES : DB_WORKER_TYPES;
  if (!allowed.has(v)) {
    const err = new Error(
      assignableOnly
        ? 'worker_type debe ser fijo u ocasional.'
        : 'worker_type no es válido para filtrar.'
    );
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeIdType(value, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim().toLowerCase();
  if (!VALID_ID_TYPES.has(v)) {
    const err = new Error('id_type debe ser nacional o extranjero.');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeActiveFilter(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'all') return 'all';
  const err = new Error('El filtro active debe ser true, false o all.');
  err.status = 400;
  throw err;
}

function normalizePhone(value) {
  const phone = normalizeText(value);
  if (!phone) return null;
  if (!PHONE_ALLOWED_REGEX.test(phone)) {
    const err = new Error(
      'El teléfono solo puede contener números y caracteres como +, -, paréntesis y espacios.'
    );
    err.status = 400;
    throw err;
  }
  return phone;
}

async function assertUniqueIdentity({ clientId, idType, idNumber, excludeWorkerId = null }) {
  if (!idNumber) return;
  const res = await pool.query(
    `SELECT id
     FROM workers
     WHERE client_id = $1
       AND id_type = $2
       AND id_number = $3
       AND ($4::uuid IS NULL OR id <> $4::uuid)
     LIMIT 1`,
    [clientId, idType, idNumber, excludeWorkerId]
  );
  if (res.rows[0]) {
    const err = new Error('Ya existe un trabajador con ese tipo y número de identificación.');
    err.status = 409;
    throw err;
  }
}

async function listWorkers({ clientId, active, type, search }) {
  const normalizedActive = normalizeActiveFilter(active);
  const normalizedType = type ? normalizeWorkerType(type) : null;
  const normalizedSearch = String(search || '').trim().toLowerCase();
  const searchLike = normalizedSearch ? `%${normalizedSearch}%` : null;

  const res = await pool.query(
    `SELECT id, worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
            phone, notes, is_active, created_at, updated_at
     FROM workers
     WHERE client_id = $1
       AND ($2::text = 'all' OR is_active = $2::boolean)
       AND ($3::text IS NULL OR worker_type = $3::worker_type)
       AND (
         $4::text IS NULL
         OR lower(concat_ws(' ', first_name, last_name_1, last_name_2)) LIKE $4
         OR lower(COALESCE(id_number, '')) LIKE $4
       )
     ORDER BY is_active DESC, first_name ASC, last_name_1 ASC, last_name_2 ASC`,
    [clientId, normalizedActive === 'all' ? 'all' : normalizedActive, normalizedType, searchLike]
  );
  return res.rows;
}

async function getWorkerById({ workerId, clientId }) {
  const res = await pool.query(
    `SELECT id, worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
            phone, notes, is_active, created_at, updated_at
     FROM workers
     WHERE id = $1
       AND client_id = $2`,
    [workerId, clientId]
  );
  return res.rows[0] || null;
}

async function createWorker({
  clientId,
  userId,
  workerType,
  firstName,
  lastName1,
  lastName2,
  idType,
  idNumber,
  phone,
  notes,
}) {
  const cleanWorkerType = normalizeWorkerType(workerType, { required: true, assignableOnly: true });
  const cleanFirstName = normalizeText(firstName, { required: true, field: 'first_name' });
  const cleanLastName1 = normalizeText(lastName1);
  const cleanLastName2 = normalizeText(lastName2);
  const cleanIdType = normalizeIdType(idType, { required: true });
  const cleanIdNumber = normalizeText(idNumber);
  const cleanPhone = normalizePhone(phone);
  const cleanNotes = normalizeText(notes);

  await assertUniqueIdentity({
    clientId,
    idType: cleanIdType,
    idNumber: cleanIdNumber,
  });

  const res = await pool.query(
    `INSERT INTO workers (
       worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
       phone, notes, client_id, created_by_user_id, updated_by_user_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     RETURNING id, worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
               phone, notes, is_active, created_at, updated_at`,
    [
      cleanWorkerType,
      cleanFirstName,
      cleanLastName1,
      cleanLastName2,
      cleanIdType,
      cleanIdNumber,
      cleanPhone,
      cleanNotes,
      clientId,
      userId,
    ]
  );
  return res.rows[0];
}

async function updateWorker({
  clientId,
  workerId,
  userId,
  workerType,
  firstName,
  lastName1,
  lastName2,
  idType,
  idNumber,
  phone,
  notes,
}) {
  const current = await getWorkerById({ workerId, clientId });
  if (!current) return null;

  const nextWorkerType =
    workerType !== undefined
      ? normalizeWorkerType(workerType, { required: true, assignableOnly: true })
      : current.worker_type;
  const nextFirstName =
    firstName !== undefined
      ? normalizeText(firstName, { required: true, field: 'first_name' })
      : current.first_name;
  const nextIdType =
    idType !== undefined ? normalizeIdType(idType, { required: true }) : current.id_type;
  const nextIdNumber = idNumber !== undefined ? normalizeText(idNumber) : current.id_number;

  await assertUniqueIdentity({
    clientId,
    idType: nextIdType,
    idNumber: nextIdNumber,
    excludeWorkerId: workerId,
  });

  const fields = [];
  const values = [];
  let idx = 1;

  if (workerType !== undefined) {
    fields.push(`worker_type = $${idx++}`);
    values.push(nextWorkerType);
  }
  if (firstName !== undefined) {
    fields.push(`first_name = $${idx++}`);
    values.push(nextFirstName);
  }
  if (lastName1 !== undefined) {
    fields.push(`last_name_1 = $${idx++}`);
    values.push(normalizeText(lastName1));
  }
  if (lastName2 !== undefined) {
    fields.push(`last_name_2 = $${idx++}`);
    values.push(normalizeText(lastName2));
  }
  if (idType !== undefined) {
    fields.push(`id_type = $${idx++}`);
    values.push(nextIdType);
  }
  if (idNumber !== undefined) {
    fields.push(`id_number = $${idx++}`);
    values.push(nextIdNumber);
  }
  if (phone !== undefined) {
    fields.push(`phone = $${idx++}`);
    values.push(normalizePhone(phone));
  }
  if (notes !== undefined) {
    fields.push(`notes = $${idx++}`);
    values.push(normalizeText(notes));
  }

  if (!fields.length) {
    const err = new Error('No hay cambios para actualizar.');
    err.status = 400;
    throw err;
  }

  fields.push(`updated_by_user_id = $${idx++}`);
  values.push(userId);
  fields.push(`updated_at = NOW()`);
  values.push(workerId);

  const res = await pool.query(
    `UPDATE workers
     SET ${fields.join(', ')}
     WHERE id = $${idx}
       AND client_id = $${idx + 1}
     RETURNING id, worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
               phone, notes, is_active, created_at, updated_at`,
    [...values, clientId]
  );
  return res.rows[0] || null;
}

async function setWorkerActive({ workerId, clientId, userId, isActive }) {
  const res = await pool.query(
    `UPDATE workers
     SET is_active = $2,
         updated_by_user_id = $3,
         updated_at = NOW()
     WHERE id = $1
       AND client_id = $4
     RETURNING id, worker_type, first_name, last_name_1, last_name_2, id_type, id_number,
               phone, notes, is_active, created_at, updated_at`,
    [workerId, !!isActive, userId, clientId]
  );
  return res.rows[0] || null;
}

module.exports = {
  listWorkers,
  getWorkerById,
  createWorker,
  updateWorker,
  setWorkerActive,
};

