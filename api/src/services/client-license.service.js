const { pool } = require('../db');
const auditService = require('./audit.service');
const {
  todayYmdInTimezone,
  toIsoDateFromDb,
  formatLicenseExpiryDisplay,
  isDateAfterToday,
  isDateOnOrBefore,
  parseYmd,
  computeLicenseDates,
  DEFAULT_TIMEZONE,
} = require('../lib/licenseDates');

function licenseExpiresIso(client) {
  if (!client || client.license_expires_on == null) return null;
  return toIsoDateFromDb(client.license_expires_on);
}

function getLicenseTimezone() {
  return process.env.LICENSE_TIMEZONE || DEFAULT_TIMEZONE;
}

function getTodayYmd() {
  return todayYmdInTimezone(getLicenseTimezone());
}

/**
 * @param {{ status?: string|null, license_expires_on?: string|Date|null }} client
 */
function isClientLicenseExpired(client, todayYmd = getTodayYmd()) {
  if (!client) return false;
  const status = String(client.status || client.client_status || '').trim().toLowerCase();
  if (status === 'license_expired') return true;
  const expires = licenseExpiresIso(client);
  if (!expires) return false;
  return isDateAfterToday(expires, todayYmd);
}

function isClientLicenseValid(client, todayYmd = getTodayYmd()) {
  if (!client) return true;
  const status = String(client.status || client.client_status || '').trim().toLowerCase();
  if (status !== 'active') return false;
  const expires = licenseExpiresIso(client);
  if (!expires) return true;
  return isDateOnOrBefore(expires, todayYmd);
}

/** Meta de licencia para login y GET /api/auth/me */
function clientLicenseRowToMeta(clientRow) {
  if (!clientRow || clientRow.license_expires_on == null) {
    return {
      licenseExpiresOn: null,
      licenseExpiresOnDisplay: null,
      licenseValid: true,
    };
  }
  const expires = licenseExpiresIso(clientRow);
  return {
    licenseExpiresOn: expires,
    licenseExpiresOnDisplay: formatLicenseExpiryDisplay(clientRow.license_expires_on),
    licenseValid: isClientLicenseValid(clientRow),
  };
}

function createLicenseExpiredError() {
  const err = new Error('Licencia vencida.');
  err.code = 'LICENSE_EXPIRED';
  err.status = 403;
  return err;
}

function assertTenantLicenseAllowed(clientRow) {
  if (!clientRow) return;
  if (isClientLicenseExpired(clientRow) || !isClientLicenseValid(clientRow)) {
    throw createLicenseExpiredError();
  }
}

async function revokeAllSessionsForClient(clientId) {
  const res = await pool.query(
    `UPDATE sessions s
     SET revoked_at = NOW()
     FROM users u
     WHERE s.revoked_at IS NULL
       AND (
         (u.id = s.user_id AND u.client_id = $1::uuid)
         OR s.acting_client_id = $1::uuid
       )
       AND s.user_id = u.id
     RETURNING s.id`,
    [clientId]
  );
  return res.rowCount;
}

/**
 * Cron: clientes active con license_expires_on <= hoy → license_expired + revocar sesiones.
 */
async function processLicenseExpiryForToday() {
  const today = getTodayYmd();
  const clientsRes = await pool.query(
    `SELECT id, name, license_expires_on, status
     FROM clients
     WHERE lower(trim(coalesce(status, ''))) = 'active'
       AND license_expires_on IS NOT NULL
       AND license_expires_on <= $1::date`,
    [today]
  );

  let expiredCount = 0;
  let sessionsRevoked = 0;

  for (const row of clientsRes.rows) {
    await pool.query(
      `UPDATE clients SET status = 'license_expired', updated_at = NOW() WHERE id = $1::uuid`,
      [row.id]
    );
    expiredCount += 1;

    await auditService.logSecurityEvent({
      eventType: 'license_expired',
      userId: null,
      clientId: row.id,
      metadata: {
        clientName: row.name,
        licenseExpiresOn: toIsoDateFromDb(row.license_expires_on),
        today,
      },
    });

    const revoked = await revokeAllSessionsForClient(row.id);
    sessionsRevoked += revoked;

    await auditService.logSecurityEvent({
      eventType: 'license_sessions_revoked',
      userId: null,
      clientId: row.id,
      metadata: { sessionsRevoked: revoked, reason: 'license_expired' },
    });
  }

  return { today, expiredCount, sessionsRevoked };
}

async function fetchPlanForLicense(db, planId) {
  const res = await db.query(
    `SELECT id, name, billing_model, trial_days
     FROM plans WHERE id = $1::uuid LIMIT 1`,
    [planId]
  );
  return res.rows[0] || null;
}

function normalizeStartsOn(value, fallbackYmd) {
  if (value == null || String(value).trim() === '') return fallbackYmd;
  const p = parseYmd(value);
  if (!p) {
    const err = new Error('license_starts_on debe ser YYYY-MM-DD.');
    err.status = 400;
    throw err;
  }
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/**
 * Lee el plan y calcula license_starts_on, license_expires_on, billing_anchor_day.
 */
async function buildLicenseFieldsFromPlan({
  planId,
  licenseStartsOn,
  billingAnchorDay,
  trialDaysOverride,
  db = pool,
}) {
  const plan = await fetchPlanForLicense(db, planId);
  if (!plan) {
    const err = new Error('El plan indicado no existe.');
    err.status = 400;
    throw err;
  }
  const starts = normalizeStartsOn(licenseStartsOn, getTodayYmd());
  const computed = computeLicenseDates({
    billingModel: plan.billing_model,
    trialDays: plan.trial_days,
    trialDaysOverride,
    licenseStartsOn: starts,
    billingAnchorDay,
  });
  return { plan, ...computed };
}

module.exports = {
  getLicenseTimezone,
  getTodayYmd,
  isClientLicenseExpired,
  isClientLicenseValid,
  clientLicenseRowToMeta,
  buildLicenseUserFields: clientLicenseRowToMeta,
  createLicenseExpiredError,
  assertTenantLicenseAllowed,
  revokeAllSessionsForClient,
  processLicenseExpiryForToday,
  buildLicenseFieldsFromPlan,
  resolveLicenseColumnsForPlan: buildLicenseFieldsFromPlan,
  normalizeStartsOn,
};
