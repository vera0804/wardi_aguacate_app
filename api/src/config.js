require('dotenv').config();

const BCRYPT_COST = 12;

const SESSION_COOKIE_NAME = 'sid';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_DB_TTL_SQL = "INTERVAL '24 hours'";
const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ROTATE_MS = 15 * 60 * 1000;
const SESSION_ROTATION_GRACE_MS = 60 * 1000;
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1h
const REVOKED_SESSION_RETENTION_DAYS = 7; // delete revoked sessions after N days

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required('DATABASE_URL'),
  bcryptCost: BCRYPT_COST,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionIdleMs: SESSION_IDLE_MS,
  sessionDbTtlSql: SESSION_DB_TTL_SQL,
  sessionCookieMaxAgeMs: SESSION_COOKIE_MAX_AGE_MS,
  sessionRotateMs: SESSION_ROTATE_MS,
  sessionRotationGraceMs: SESSION_ROTATION_GRACE_MS,
  sessionCleanupIntervalMs: SESSION_CLEANUP_INTERVAL_MS,
  revokedSessionRetentionDays: REVOKED_SESSION_RETENTION_DAYS,

  // Anti session fixation: al iniciar sesión, invalidar sesiones previas del usuario.
  revokeExistingSessionsOnLogin:
    process.env.REVOKE_EXISTING_SESSIONS_ON_LOGIN !== '0',

  // Anti robo: validar (opcionalmente) fingerprint de sesión.
  // Por defecto validamos user-agent; IP va deshabilitada para evitar falsos positivos (cambios por NAT).
  sessionBindingCheckUserAgent:
    process.env.SESSION_BINDING_CHECK_UA !== '0',
  sessionBindingCheckIp: process.env.SESSION_BINDING_CHECK_IP === '1',
  // Cuando están habilitados ambos (UA + IP), revocamos si hay cambio en ambos (modo "both")
  // para reducir falsos positivos. Si solo uno está habilitado, el cambio de ese uno revoca.
  sessionBindingRevokeMode: process.env.SESSION_BINDING_REVOKE_MODE || 'both',

  // Rate limiting avanzado para login
  loginRateLimitWindowMs: 15 * 60 * 1000,
  loginRateLimitMaxByIp: Number(process.env.LOGIN_RL_MAX_BY_IP || 30),
  loginRateLimitMaxByUser: Number(process.env.LOGIN_RL_MAX_BY_USER || 10),
  maxFailedLogins: MAX_FAILED_LOGINS,
  lockoutMinutes: LOCKOUT_MINUTES,
  isProd,
  corsOrigins: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
  trustProxy: process.env.TRUST_PROXY === '1',

  /**
   * Por request: BEGIN + set_config('app.tenant_id') + pool enrutado (RLS con rol app).
   * Desactivar solo para depuración: TENANT_RLS_REQUEST_SCOPE=0
   */
  tenantRlsRequestScope: process.env.TENANT_RLS_REQUEST_SCOPE !== '0',

  licenseTimezone: process.env.LICENSE_TIMEZONE || 'America/Costa_Rica',
  licenseCronSchedule: process.env.LICENSE_CRON_SCHEDULE || '59 23 * * *',
  licenseCronEnabled: process.env.LICENSE_CRON_ENABLED !== '0',
};
