const { pool } = require('../db');
const { billingModelLabel } = require('../lib/licenseDates');

const BILLING_MODELS = new Set(['perpetual', 'trial_days', 'monthly_anchor']);

function normalizePlanName(value) {
  const v = String(value || '').trim();
  if (!v) {
    const err = new Error('El nombre del plan es obligatorio.');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeNonNegativeInt(value, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    const err = new Error(`${field} debe ser un entero mayor o igual a 0.`);
    err.status = 400;
    throw err;
  }
  return n;
}

function normalizeBillingModel(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!BILLING_MODELS.has(v)) {
    const err = new Error('billing_model debe ser perpetual, trial_days o monthly_anchor.');
    err.status = 400;
    throw err;
  }
  return v;
}

function normalizeTrialDays(billingModel, trialDays) {
  if (billingModel !== 'trial_days') return null;
  const n = Number(trialDays);
  if (!Number.isFinite(n) || n < 1) {
    const err = new Error('trial_days es obligatorio y debe ser al menos 1 para planes demo.');
    err.status = 400;
    throw err;
  }
  return Math.trunc(n);
}

function parsePlanPayload(body, { partial = false } = {}) {
  const b = body || {};
  const out = {};

  if (!partial || b.name !== undefined) {
    out.name = normalizePlanName(b.name);
  }
  if (!partial || b.max_farms !== undefined) {
    out.max_farms = normalizeNonNegativeInt(b.max_farms, 'max_farms');
  }
  if (!partial || b.max_lots_per_farm !== undefined) {
    out.max_lots_per_farm = normalizeNonNegativeInt(b.max_lots_per_farm, 'max_lots_per_farm');
  }
  if (!partial || b.max_users_admin !== undefined) {
    out.max_users_admin = normalizeNonNegativeInt(b.max_users_admin, 'max_users_admin');
  }
  if (!partial || b.max_users_operario !== undefined) {
    out.max_users_operario = normalizeNonNegativeInt(b.max_users_operario, 'max_users_operario');
  }
  if (!partial || b.price !== undefined) {
    out.price = normalizeNonNegativeInt(b.price, 'price');
  }
  if (!partial || b.billing_model !== undefined) {
    out.billing_model = normalizeBillingModel(b.billing_model);
  }
  if (b.trial_days !== undefined) {
    const model =
      out.billing_model ??
      (b.billing_model != null ? normalizeBillingModel(b.billing_model) : null);
    if (!model && partial) {
      /* trial_days sin billing_model en PATCH: se valida en updatePlan con el plan existente */
    } else {
      out.trial_days = normalizeTrialDays(model || 'perpetual', b.trial_days);
    }
  } else if (!partial && out.billing_model) {
    out.trial_days = normalizeTrialDays(out.billing_model, b.trial_days);
  }
  if (!partial || b.description !== undefined) {
    const d = b.description != null ? String(b.description).trim() : '';
    out.description = d || null;
  }

  return out;
}

function mapPlanRow(row) {
  if (!row) return row;
  return {
    ...row,
    is_active: row.is_active !== false,
    billing_model_label: billingModelLabel(row.billing_model),
    active_client_count: Number(row.active_client_count ?? 0),
  };
}

async function listActiveClientsOnPlan(planId) {
  const res = await pool.query(
    `SELECT c.id, c.name, c.status, c.license_expires_on, c.created_at
     FROM clients c
     WHERE c.plan_id = $1::uuid
       AND lower(trim(coalesce(c.status, ''))) = 'active'
     ORDER BY c.name ASC`,
    [planId]
  );
  return res.rows;
}

async function countActiveClientsOnPlan(planId, db = pool) {
  const res = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM clients c
     WHERE c.plan_id = $1::uuid
       AND lower(trim(coalesce(c.status, ''))) = 'active'`,
    [planId]
  );
  return res.rows[0]?.n ?? 0;
}

async function getPlanById(planId) {
  const res = await pool.query(
    `SELECT p.id, p.name, p.max_farms, p.max_lots_per_farm, p.max_users_admin, p.max_users_operario,
            p.price, p.billing_model, p.trial_days, p.description, p.is_active, p.created_at,
            (SELECT COUNT(*)::int FROM clients c
             WHERE c.plan_id = p.id AND lower(trim(coalesce(c.status, ''))) = 'active') AS active_client_count
     FROM plans p
     WHERE p.id = $1::uuid`,
    [planId]
  );
  return mapPlanRow(res.rows[0] || null);
}

async function listAllPlans() {
  const res = await pool.query(
    `SELECT p.id, p.name, p.max_farms, p.max_lots_per_farm, p.max_users_admin, p.max_users_operario,
            p.price, p.billing_model, p.trial_days, p.description, p.is_active, p.created_at,
            (SELECT COUNT(*)::int FROM clients c
             WHERE c.plan_id = p.id AND lower(trim(coalesce(c.status, ''))) = 'active') AS active_client_count
     FROM plans p
     ORDER BY p.is_active DESC, p.name ASC`
  );
  return res.rows.map(mapPlanRow);
}

async function getPlanImpact(planId) {
  const plan = await getPlanById(planId);
  if (!plan) {
    const err = new Error('Plan no encontrado.');
    err.status = 404;
    throw err;
  }
  const clients = await listActiveClientsOnPlan(planId);
  return {
    plan_id: plan.id,
    plan_name: plan.name,
    active_client_count: clients.length,
    active_clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
    })),
    message:
      clients.length > 0
        ? `Hay ${clients.length} organización(es) activa(s) con este plan. Los cambios en límites y configuración del plan se aplican de inmediato a esas organizaciones.`
        : 'Ninguna organización activa usa este plan actualmente.',
  };
}

function assertAcknowledgedImpact(impact, acknowledge) {
  if (impact.active_client_count > 0 && !acknowledge) {
    const err = new Error(
      'Debe confirmar que entiende el impacto sobre las organizaciones activas (acknowledge_affected_clients).'
    );
    err.status = 409;
    err.code = 'PLAN_IMPACT_NOT_ACKNOWLEDGED';
    err.impact = impact;
    throw err;
  }
}

async function createPlan(body) {
  const p = parsePlanPayload(body);
  const res = await pool.query(
    `INSERT INTO plans (
       name, max_farms, max_lots_per_farm, max_users_admin, max_users_operario,
       price, billing_model, trial_days, description, is_active
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
     RETURNING id`,
    [
      p.name,
      p.max_farms,
      p.max_lots_per_farm,
      p.max_users_admin,
      p.max_users_operario,
      p.price,
      p.billing_model,
      p.trial_days,
      p.description,
    ]
  );
  return getPlanById(res.rows[0].id);
}

async function updatePlan(planId, body) {
  const id = String(planId || '').trim();
  const existing = await getPlanById(id);
  if (!existing) {
    const err = new Error('Plan no encontrado.');
    err.status = 404;
    throw err;
  }

  const impact = await getPlanImpact(id);
  assertAcknowledgedImpact(impact, body?.acknowledge_affected_clients === true);

  const p = parsePlanPayload(body, { partial: true });
  const effectiveBilling = p.billing_model ?? existing.billing_model;
  if (p.billing_model === 'trial_days' && p.trial_days === undefined) {
    if (!existing.trial_days) {
      const err = new Error('trial_days es obligatorio para planes demo.');
      err.status = 400;
      throw err;
    }
  }
  if (p.trial_days === undefined && body?.trial_days !== undefined) {
    p.trial_days = normalizeTrialDays(effectiveBilling, body.trial_days);
  }

  const fields = [];
  const vals = [];
  let i = 1;

  const setters = {
    name: p.name,
    max_farms: p.max_farms,
    max_lots_per_farm: p.max_lots_per_farm,
    max_users_admin: p.max_users_admin,
    max_users_operario: p.max_users_operario,
    price: p.price,
    billing_model: p.billing_model,
    trial_days: p.trial_days,
    description: p.description,
  };

  for (const [col, val] of Object.entries(setters)) {
    if (val !== undefined) {
      fields.push(`${col} = $${i++}`);
      vals.push(val);
    }
  }

  if (fields.length === 0) {
    const err = new Error('No hay campos para actualizar.');
    err.status = 400;
    throw err;
  }

  if (p.billing_model !== undefined && p.billing_model !== 'trial_days') {
    fields.push(`trial_days = $${i++}`);
    vals.push(null);
  }

  vals.push(id);
  await pool.query(`UPDATE plans SET ${fields.join(', ')} WHERE id = $${i}::uuid`, vals);

  const updated = await getPlanById(id);
  return { plan: updated, impact };
}

async function deactivatePlan(planId, { acknowledgeAffectedClients = false } = {}) {
  const id = String(planId || '').trim();
  const existing = await getPlanById(id);
  if (!existing) {
    const err = new Error('Plan no encontrado.');
    err.status = 404;
    throw err;
  }
  if (!existing.is_active) {
    return { plan: existing, impact: await getPlanImpact(id) };
  }

  const impact = await getPlanImpact(id);
  assertAcknowledgedImpact(impact, acknowledgeAffectedClients);

  await pool.query(`UPDATE plans SET is_active = false WHERE id = $1::uuid`, [id]);
  const plan = await getPlanById(id);
  return { plan, impact };
}

async function assertPlanActiveForNewClient(planId, db = pool) {
  const res = await db.query(
    `SELECT id, is_active FROM plans WHERE id = $1::uuid LIMIT 1`,
    [planId]
  );
  const row = res.rows[0];
  if (!row) {
    const err = new Error('El plan indicado no existe.');
    err.status = 400;
    throw err;
  }
  if (!row.is_active) {
    const err = new Error('El plan seleccionado está inactivo. Elija otro plan o reactive este plan.');
    err.status = 400;
    throw err;
  }
}

module.exports = {
  listAllPlans,
  getPlanById,
  getPlanImpact,
  listActiveClientsOnPlan,
  createPlan,
  updatePlan,
  deactivatePlan,
  assertPlanActiveForNewClient,
  mapPlanRow,
};
