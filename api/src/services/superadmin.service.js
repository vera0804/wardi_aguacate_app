const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { assertPasswordPolicy } = require('../lib/passwordPolicy');

const BCRYPT_ROUNDS = 12;

function normalizeEmail(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) {
    const err = new Error('El correo del administrador es obligatorio.');
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

function normalizeName(value, field) {
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return v;
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
    const err = new Error('Ya existe otro usuario activo con este correo.');
    err.status = 409;
    throw err;
  }
}

async function listPlans() {
  const res = await pool.query(
    `SELECT id, name, max_farms, max_lots_per_farm, max_users_admin, max_users_operario, price, created_at
     FROM plans
     ORDER BY name ASC`
  );
  return res.rows;
}

async function listClients() {
  const res = await pool.query(
    `SELECT c.id, c.name, c.status, c.plan_id, c.created_at,
            p.name AS plan_name
     FROM clients c
     LEFT JOIN plans p ON p.id = c.plan_id
     ORDER BY c.name ASC`
  );
  return res.rows;
}

async function getRoleIdByName(db, roleNameNorm) {
  const res = await db.query(`SELECT id FROM roles WHERE lower(trim(name)) = $1 LIMIT 1`, [roleNameNorm]);
  return res.rows[0]?.id || null;
}

/**
 * Crea cliente + usuario administrador inicial (rol admin).
 */
async function createClientWithAdmin({
  clientName,
  planId,
  adminEmail,
  adminPasswordPlain,
  adminFirstName,
  adminLastName1,
  adminLastName2,
  createdBySuperadminUserId,
}) {
  const name = String(clientName || '').trim();
  if (!name) {
    const err = new Error('El nombre de la organización es obligatorio.');
    err.status = 400;
    throw err;
  }
  const plan = String(planId || '').trim();
  if (!plan) {
    const err = new Error('Debe seleccionar un plan.');
    err.status = 400;
    throw err;
  }
  const email = normalizeEmail(adminEmail);
  const pwd = assertPasswordPolicy(adminPasswordPlain);
  const fn = normalizeName(adminFirstName, 'Nombre del administrador');
  const ln1 = normalizeName(adminLastName1, 'Primer apellido');
  const ln2 = adminLastName2 != null && String(adminLastName2).trim() ? String(adminLastName2).trim() : null;

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const planRow = await db.query(`SELECT id FROM plans WHERE id = $1::uuid LIMIT 1`, [plan]);
    if (!planRow.rows[0]) {
      const err = new Error('El plan indicado no existe.');
      err.status = 400;
      throw err;
    }
    await assertGlobalActiveEmailFree({ db, email, excludeUserId: null });

    const insClient = await db.query(
      `INSERT INTO clients (name, plan_id, status)
       VALUES ($1, $2::uuid, 'active')
       RETURNING id, name, plan_id, status, created_at`,
      [name, plan]
    );
    const client = insClient.rows[0];
    const adminRoleId = await getRoleIdByName(db, 'admin');
    if (!adminRoleId) {
      const err = new Error('Rol admin no configurado en el sistema.');
      err.status = 500;
      throw err;
    }
    const idNumber = `ADM-${crypto.randomUUID().replace(/-/g, '')}`;
    const hash = await bcrypt.hash(pwd, BCRYPT_ROUNDS);
    await db.query(
      `INSERT INTO users (
         is_active, first_name, last_name_1, last_name_2, email,
         phone_1, phone_2, id_type, id_number, password_hash,
         client_id, role_id, created_by_user_id, updated_by_user_id
       )
       VALUES (true, $1, $2, $3, $4, NULL, NULL, 'extranjero'::id_type, $5, $6, $7::uuid, $8::uuid, $9::uuid, $9::uuid)`,
      [fn, ln1, ln2, email, idNumber, hash, client.id, adminRoleId, createdBySuperadminUserId]
    );
    await db.query('COMMIT');

    const list = await pool.query(
      `SELECT c.id, c.name, c.status, c.plan_id, c.created_at, p.name AS plan_name
       FROM clients c
       LEFT JOIN plans p ON p.id = c.plan_id
       WHERE c.id = $1`,
      [client.id]
    );
    return list.rows[0];
  } catch (e) {
    await db.query('ROLLBACK');
    if (e.code === '23505') {
      const err = new Error('Conflicto de datos únicos (correo o identificación).');
      err.status = 409;
      throw err;
    }
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  listPlans,
  listClients,
  createClientWithAdmin,
};
