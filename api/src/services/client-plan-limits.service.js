const { pool } = require('../db');

/**
 * Límites del plan asignado al cliente (LEFT JOIN: sin plan devuelve nulls).
 * @param {string} clientId
 */
async function getClientPlanLimits(clientId) {
  const res = await pool.query(
    `SELECT c.id AS client_id,
            c.plan_id,
            p.max_farms,
            p.max_lots_per_farm,
            p.max_users_admin,
            p.max_users_operario
     FROM clients c
     LEFT JOIN plans p ON p.id = c.plan_id
     WHERE c.id = $1`,
    [clientId]
  );
  return res.rows[0] || null;
}

async function countActiveLotsOnFarm({ db, clientId, farmId, excludeLotId = null }) {
  const cx = db || pool;
  const res = await cx.query(
    `SELECT COUNT(*)::int AS n
     FROM lots
     WHERE client_id = $1
       AND farm_id = $2
       AND is_active = true
       AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [clientId, farmId, excludeLotId]
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Impide crear o activar un lote si la finca ya alcanzó max_lots_per_farm del plan.
 * @param {{ db?: object, clientId: string, farmId: string, excludeLotId?: string|null }} params
 */
async function assertLotCapacityOnFarm({ db, clientId, farmId, excludeLotId = null }) {
  const row = await getClientPlanLimits(clientId);
  if (!row) {
    const err = new Error('Cliente no encontrado.');
    err.status = 404;
    throw err;
  }
  if (row.plan_id == null) {
    const err = new Error('El cliente no tiene un plan asignado.');
    err.status = 409;
    throw err;
  }
  const max = row.max_lots_per_farm;
  if (max == null) return;
  const n = await countActiveLotsOnFarm({ db, clientId, farmId, excludeLotId });
  if (n >= Number(max)) {
    const err = new Error(
      'Has alcanzado el máximo de lotes activos permitidos por finca según tu plan.'
    );
    err.status = 409;
    throw err;
  }
}

async function countActiveUsersByRoleName(clientId, roleNameNorm, { excludeUserId = null } = {}) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.client_id = $1
       AND u.is_active = true
       AND lower(trim(r.name)) = $2
       AND ($3::uuid IS NULL OR u.id <> $3::uuid)`,
    [clientId, roleNameNorm, excludeUserId]
  );
  return res.rows[0]?.n ?? 0;
}

/**
 * Valida cupo de rol en el plan al sumar `additionalActive` usuarios activos con ese rol
 * (p. ej. 1 al crear o reactivar; al cambiar rol, excluir al usuario y sumar 1 para el rol destino).
 * @param {{ clientId: string, roleName: string, excludeUserId?: string|null, additionalActive?: number }} params
 */
async function assertUserRoleSlotAvailable({
  clientId,
  roleName,
  excludeUserId = null,
  additionalActive = 1,
}) {
  const row = await getClientPlanLimits(clientId);
  if (!row) {
    const err = new Error('Cliente no encontrado.');
    err.status = 404;
    throw err;
  }
  if (row.plan_id == null) {
    const err = new Error('El cliente no tiene un plan asignado.');
    err.status = 409;
    throw err;
  }
  const r = String(roleName || '').trim().toLowerCase();
  let max = null;
  if (r === 'admin') max = row.max_users_admin;
  else if (r === 'operario') max = row.max_users_operario;
  else {
    const err = new Error('Rol de usuario no válido para el plan.');
    err.status = 400;
    throw err;
  }
  if (max == null) return;
  const n = await countActiveUsersByRoleName(clientId, r, { excludeUserId });
  if (n + Number(additionalActive) > Number(max)) {
    const err = new Error(
      r === 'admin'
        ? 'Has alcanzado el máximo de usuarios administradores permitidos por tu plan.'
        : 'Has alcanzado el máximo de usuarios operarios permitidos por tu plan.'
    );
    err.status = 409;
    throw err;
  }
}

module.exports = {
  getClientPlanLimits,
  countActiveLotsOnFarm,
  assertLotCapacityOnFarm,
  countActiveUsersByRoleName,
  assertUserRoleSlotAvailable,
};
