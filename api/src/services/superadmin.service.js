const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const { assertPasswordPolicy } = require('../lib/passwordPolicy');
const { billingModelLabel, toIsoDateFromDb, formatLicenseExpiryDisplay } = require('../lib/licenseDates');
const clientLicenseService = require('./client-license.service');
const superadminPlansService = require('./superadmin-plans.service');

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
    `SELECT id, name, max_farms, max_lots_per_farm, max_users_admin, max_users_operario,
            price, billing_model, trial_days, description, created_at
     FROM plans
     WHERE COALESCE(is_active, true) = true
     ORDER BY name ASC`
  );
  return res.rows.map((row) => ({
    ...row,
    billing_model_label: billingModelLabel(row.billing_model),
  }));
}

function mapClientRowForApi(row) {
  if (!row) return row;
  const license_starts_on = toIsoDateFromDb(row.license_starts_on);
  const license_expires_on = toIsoDateFromDb(row.license_expires_on);
  return {
    ...row,
    license_starts_on,
    license_expires_on,
    license_expires_on_display: license_expires_on
      ? formatLicenseExpiryDisplay(row.license_expires_on)
      : null,
  };
}

async function listClients() {
  const res = await pool.query(
    `SELECT c.id, c.name, c.status, c.plan_id, c.created_at,
            c.license_starts_on, c.license_expires_on, c.billing_anchor_day,
            p.name AS plan_name
     FROM clients c
     LEFT JOIN plans p ON p.id = c.plan_id
     ORDER BY c.name ASC`
  );
  return res.rows.map(mapClientRowForApi);
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
  licenseStartsOn,
  billingAnchorDay,
  trialDaysOverride,
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
    await superadminPlansService.assertPlanActiveForNewClient(plan, db);
    const licenseCols = await clientLicenseService.buildLicenseFieldsFromPlan({
      planId: plan,
      licenseStartsOn,
      billingAnchorDay,
      trialDaysOverride,
      db,
    });

    await assertGlobalActiveEmailFree({ db, email, excludeUserId: null });

    const insClient = await db.query(
      `INSERT INTO clients (
         name, plan_id, status,
         license_starts_on, license_expires_on, billing_anchor_day
       )
       VALUES ($1, $2::uuid, 'active', $3::date, $4::date, $5)
       RETURNING id, name, plan_id, status, license_starts_on, license_expires_on,
                 billing_anchor_day, created_at`,
      [
        name,
        plan,
        licenseCols.licenseStartsOn,
        licenseCols.licenseExpiresOn,
        licenseCols.billingAnchorDay,
      ]
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
      `SELECT c.id, c.name, c.status, c.plan_id, c.created_at,
              c.license_starts_on, c.license_expires_on, c.billing_anchor_day,
              p.name AS plan_name
       FROM clients c
       LEFT JOIN plans p ON p.id = c.plan_id
       WHERE c.id = $1`,
      [client.id]
    );
    return mapClientRowForApi(list.rows[0]);
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

/**
 * Renueva licencia: recalcula fechas, status active, opcional cambio de plan.
 */
async function renewClientLicense({
  clientId,
  planId,
  licenseStartsOn,
  billingAnchorDay,
  trialDaysOverride,
  renewedBySuperadminUserId,
}) {
  const cid = String(clientId || '').trim();
  if (!cid) {
    const err = new Error('clientId es obligatorio.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const cur = await db.query(
      `SELECT id, plan_id, name FROM clients WHERE id = $1::uuid FOR UPDATE`,
      [cid]
    );
    const client = cur.rows[0];
    if (!client) {
      const err = new Error('Organización no encontrada.');
      err.status = 404;
      throw err;
    }

    const effectivePlanId = String(planId || client.plan_id || '').trim();
    if (!effectivePlanId) {
      const err = new Error('La organización no tiene plan asignado.');
      err.status = 400;
      throw err;
    }

    const licenseCols = await clientLicenseService.buildLicenseFieldsFromPlan({
      planId: effectivePlanId,
      licenseStartsOn,
      billingAnchorDay,
      trialDaysOverride,
      db,
    });

    const upd = await db.query(
      `UPDATE clients
       SET plan_id = $2::uuid,
           status = 'active',
           license_starts_on = $3::date,
           license_expires_on = $4::date,
           billing_anchor_day = $5,
           updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id, name, status, plan_id, license_starts_on, license_expires_on,
                 billing_anchor_day, created_at`,
      [
        cid,
        effectivePlanId,
        licenseCols.licenseStartsOn,
        licenseCols.licenseExpiresOn,
        licenseCols.billingAnchorDay,
      ]
    );
    await db.query('COMMIT');

    const row = upd.rows[0];
    const planRes = await pool.query(`SELECT name FROM plans WHERE id = $1`, [row.plan_id]);
    return mapClientRowForApi({
      ...row,
      plan_name: planRes.rows[0]?.name || null,
      renewedBySuperadminUserId,
    });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

module.exports = {
  listPlans,
  listClients,
  createClientWithAdmin,
  renewClientLicense,
  ...superadminPlansService,
};
