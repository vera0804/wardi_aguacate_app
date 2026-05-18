const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { assertUserRoleSlotAvailable } = require('./client-plan-limits.service');
const { assertPasswordPolicy } = require('../lib/passwordPolicy');

const VALID_ID_TYPES = new Set(['nacional', 'extranjero']);
const ASSIGNABLE_ROLES = new Set(['admin', 'operario']);
const BCRYPT_ROUNDS = 12;

function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) {
    const err = new Error('El correo es obligatorio.');
    err.status = 400;
    throw err;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    const err = new Error('El correo no tiene un formato válido.');
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

function normalizeNamePart(value, field, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  const v = String(value || '').trim();
  if (!v && required) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v || null;
}

function normalizePhone(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const v = String(value).trim();
  if (!/^[0-9+\-() ]+$/.test(v)) {
    const err = new Error('El teléfono solo puede contener números y +, -, paréntesis y espacios.');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeRoleName(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!ASSIGNABLE_ROLES.has(v)) {
    const err = new Error('El rol debe ser admin u operario.');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizePassword(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      const err = new Error('La contraseña es obligatoria.');
      err.status = 400;
      throw err;
    }
    return undefined;
  }
  return assertPasswordPolicy(String(value));
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name_1: row.last_name_1,
    last_name_2: row.last_name_2,
    phone_1: row.phone_1,
    phone_2: row.phone_2,
    id_type: row.id_type,
    id_number: row.id_number,
    is_active: row.is_active,
    role: row.role_name,
    role_id: row.role_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getRoleId(db, roleNameNorm) {
  const res = await db.query(`SELECT id FROM roles WHERE lower(trim(name)) = $1 LIMIT 1`, [
    roleNameNorm,
  ]);
  return res.rows[0]?.id || null;
}

async function assertGlobalActiveEmailFree({ db, email, excludeUserId = null }) {
  const res = await db.query(
    `SELECT id FROM users
     WHERE lower(trim(email)) = lower(trim($1))
       AND is_active = true
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [email, excludeUserId]
  );
  if (res.rows[0]) {
    const err = new Error(
      'Ya existe otro usuario activo con este correo en el sistema. Use otro correo o inactivé el duplicado primero.'
    );
    err.status = 409;
    throw err;
  }
}

async function countOtherActiveAdmins({ db, clientId, excludeUserId }) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.client_id = $1
       AND u.is_active = true
       AND lower(trim(r.name)) = 'admin'
       AND u.id <> $2::uuid`,
    [clientId, excludeUserId]
  );
  return res.rows[0]?.n ?? 0;
}

async function revokeSessionsForUser(db, userId) {
  await db.query(`UPDATE sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
}

async function listTenantUsers({ clientId, active = 'all' }) {
  let clause = '';
  const params = [clientId];
  if (active === true) clause = ' AND u.is_active = true';
  else if (active === false) clause = ' AND u.is_active = false';
  const res = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name_1, u.last_name_2,
            u.phone_1, u.phone_2, u.id_type, u.id_number, u.is_active, u.created_at, u.updated_at,
            u.role_id, lower(trim(r.name)) AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.client_id = $1
       ${clause}
     ORDER BY u.is_active DESC, lower(trim(u.email)) ASC`,
    params
  );
  return res.rows.map(mapRow);
}

async function createTenantUser({
  clientId,
  actorUserId,
  email,
  password,
  firstName,
  lastName1,
  lastName2,
  phone1,
  phone2,
  idType,
  idNumber,
  roleName,
}) {
  const cleanEmail = normalizeEmail(email);
  const pwd = normalizePassword(password, { required: true });
  const fn = normalizeNamePart(firstName, 'Nombre', { required: true });
  const ln1 = normalizeNamePart(lastName1, 'Primer apellido', { required: true });
  const ln2 = normalizeNamePart(lastName2, 'Segundo apellido', { required: false });
  const idT = normalizeIdType(idType, { required: true });
  const idN = normalizeNamePart(idNumber, 'Número de identificación', { required: true });
  const r = normalizeRoleName(roleName);
  const p1 = normalizePhone(phone1);
  const p2 = normalizePhone(phone2);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await assertGlobalActiveEmailFree({ db, email: cleanEmail, excludeUserId: null });
    await assertUserRoleSlotAvailable({ clientId, roleName: r, excludeUserId: null, additionalActive: 1 });
    const roleId = await getRoleId(db, r);
    if (!roleId) {
      const err = new Error('Rol no configurado en el sistema.');
      err.status = 500;
      throw err;
    }
    const hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
    const ins = await db.query(
      `INSERT INTO users (
         is_active, first_name, last_name_1, last_name_2, email,
         phone_1, phone_2, id_type, id_number, password_hash,
         client_id, role_id, created_by_user_id, updated_by_user_id
       )
       VALUES (true, $1, $2, $3, $4, $5, $6, $7::id_type, $8, $9, $10, $11, $12, $12)
       RETURNING id`,
      [fn, ln1, ln2, cleanEmail, p1, p2, idT, idN, hash, clientId, roleId, actorUserId]
    );
    const id = ins.rows[0].id;
    await db.query('COMMIT');
    const row = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name_1, u.last_name_2,
              u.phone_1, u.phone_2, u.id_type, u.id_number, u.is_active, u.created_at, u.updated_at,
              u.role_id, lower(trim(r.name)) AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.client_id = $2`,
      [id, clientId]
    );
    return mapRow(row.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      if (String(e.constraint || '').includes('email') || String(e.message || '').includes('uq_users_email')) {
        const err = new Error('Ya existe un usuario activo con este correo.');
        err.status = 409;
        throw err;
      }
      const err = new Error('Ya existe un usuario con ese tipo y número de identificación.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

async function updateTenantUser({
  id,
  clientId,
  actorUserId,
  email,
  password: passwordPlain,
  firstName,
  lastName1,
  lastName2,
  phone1,
  phone2,
  idType,
  idNumber,
  roleName,
}) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(
      `SELECT u.*, lower(trim(r.name)) AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.client_id = $2
       FOR UPDATE`,
      [id, clientId]
    );
    const cur = curRes.rows[0];
    if (!cur) {
      await db.query('ROLLBACK');
      return null;
    }

    let nextEmail = cur.email;
    if (email !== undefined) {
      nextEmail = normalizeEmail(email);
      if (
        cur.is_active &&
        String(nextEmail).toLowerCase() !== String(cur.email).toLowerCase()
      ) {
        await assertGlobalActiveEmailFree({ db, email: nextEmail, excludeUserId: id });
      }
    }

    let nextRoleName = cur.role_name;
    let nextRoleId = cur.role_id;
    if (roleName !== undefined) {
      nextRoleName = normalizeRoleName(roleName);
      const rid = await getRoleId(db, nextRoleName);
      if (!rid) {
        const err = new Error('Rol no configurado en el sistema.');
        err.status = 500;
        throw err;
      }
      nextRoleId = rid;
    }

    if (cur.is_active && nextRoleName !== cur.role_name) {
      await assertUserRoleSlotAvailable({
        clientId,
        roleName: nextRoleName,
        excludeUserId: id,
        additionalActive: 1,
      });
      if (cur.role_name === 'admin' && nextRoleName === 'operario') {
        const others = await countOtherActiveAdmins({ db, clientId, excludeUserId: id });
        if (others < 1) {
          const err = new Error('No puede degradar al único administrador activo del cliente.');
          err.status = 409;
          throw err;
        }
      }
    }

    const fn = firstName !== undefined ? normalizeNamePart(firstName, 'Nombre', { required: true }) : cur.first_name;
    const ln1 =
      lastName1 !== undefined ? normalizeNamePart(lastName1, 'Primer apellido', { required: true }) : cur.last_name_1;
    const ln2 =
      lastName2 !== undefined ? normalizeNamePart(lastName2, 'Segundo apellido', { required: false }) : cur.last_name_2;
    const idT = idType !== undefined ? normalizeIdType(idType, { required: true }) : cur.id_type;
    const idN =
      idNumber !== undefined
        ? normalizeNamePart(idNumber, 'Número de identificación', { required: true })
        : cur.id_number;
    const p1 = phone1 !== undefined ? normalizePhone(phone1) : cur.phone_1;
    const p2 = phone2 !== undefined ? normalizePhone(phone2) : cur.phone_2;

    let passwordHash = cur.password_hash;
    const pwd = normalizePassword(passwordPlain, { required: false });
    if (pwd !== undefined) {
      passwordHash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
    }

    await db.query(
      `UPDATE users SET
         email = $2,
         first_name = $3,
         last_name_1 = $4,
         last_name_2 = $5,
         phone_1 = $6,
         phone_2 = $7,
         id_type = $8::id_type,
         id_number = $9,
         password_hash = $10,
         role_id = $11::uuid,
         updated_by_user_id = $12,
         updated_at = NOW()
       WHERE id = $1 AND client_id = $13`,
      [
        id,
        nextEmail,
        fn,
        ln1,
        ln2,
        p1,
        p2,
        idT,
        idN,
        passwordHash,
        nextRoleId,
        actorUserId,
        clientId,
      ]
    );

    await db.query('COMMIT');
    const row = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name_1, u.last_name_2,
              u.phone_1, u.phone_2, u.id_type, u.id_number, u.is_active, u.created_at, u.updated_at,
              u.role_id, lower(trim(r.name)) AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.client_id = $2`,
      [id, clientId]
    );
    return mapRow(row.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      if (String(e.constraint || '').includes('email') || String(e.message || '').includes('uq_users_email')) {
        const err = new Error('Ya existe un usuario activo con este correo.');
        err.status = 409;
        throw err;
      }
      const err = new Error('Ya existe un usuario con ese tipo y número de identificación.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

async function setTenantUserActive({ id, clientId, actorUserId, isActive }) {
  const want = !!isActive;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const curRes = await db.query(
      `SELECT u.*, lower(trim(r.name)) AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.client_id = $2
       FOR UPDATE`,
      [id, clientId]
    );
    const cur = curRes.rows[0];
    if (!cur) {
      await db.query('ROLLBACK');
      return null;
    }

    if (cur.is_active === want) {
      await db.query('COMMIT');
      const row = await pool.query(
        `SELECT u.id, u.email, u.first_name, u.last_name_1, u.last_name_2,
                u.phone_1, u.phone_2, u.id_type, u.id_number, u.is_active, u.created_at, u.updated_at,
                u.role_id, lower(trim(r.name)) AS role_name
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1 AND u.client_id = $2`,
        [id, clientId]
      );
      return mapRow(row.rows[0]);
    }

    if (!want) {
      if (cur.role_name === 'admin') {
        const others = await countOtherActiveAdmins({ db, clientId, excludeUserId: id });
        if (others < 1) {
          const err = new Error('No puede inactivar al único administrador activo del cliente.');
          err.status = 409;
          throw err;
        }
      }
      await db.query(
        `UPDATE users
           SET is_active = false, updated_by_user_id = $2, updated_at = NOW()
         WHERE id = $1 AND client_id = $3`,
        [id, actorUserId, clientId]
      );
      await revokeSessionsForUser(db, id);
      await db.query('COMMIT');
    } else {
      await assertGlobalActiveEmailFree({ db, email: cur.email, excludeUserId: id });
      await assertUserRoleSlotAvailable({
        clientId,
        roleName: cur.role_name,
        excludeUserId: id,
        additionalActive: 1,
      });
      await db.query(
        `UPDATE users
           SET is_active = true, updated_by_user_id = $2, updated_at = NOW()
         WHERE id = $1 AND client_id = $3`,
        [id, actorUserId, clientId]
      );
      await db.query('COMMIT');
    }

    const row = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.last_name_1, u.last_name_2,
              u.phone_1, u.phone_2, u.id_type, u.id_number, u.is_active, u.created_at, u.updated_at,
              u.role_id, lower(trim(r.name)) AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.client_id = $2`,
      [id, clientId]
    );
    return mapRow(row.rows[0]);
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error('Ya existe un usuario activo con este correo; no se puede reactivar hasta liberarlo.');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  listTenantUsers,
  createTenantUser,
  updateTenantUser,
  setTenantUserActive,
};
