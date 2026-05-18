const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db');
const config = require('../config');
const auditService = require('./audit.service');
const { assertPasswordPolicy } = require('../lib/passwordPolicy');
const mailService = require('./mail.service');

/** Valid bcrypt hash used when no user exists (mitigates timing leaks). */
const DUMMY_PASSWORD_HASH =
  '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga311W';

const BCRYPT_ROUNDS = 12;
const RESET_TOKEN_TTL_HOURS = 2;
const PASSWORD_RESET_GENERIC_MESSAGE =
  'Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.';

let lastCleanupAtMs = 0;
let cleanupInFlight = null;

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function shouldRotateSession(lastActivity) {
  const ts =
    lastActivity instanceof Date
      ? lastActivity.getTime()
      : new Date(lastActivity).getTime();
  if (!Number.isFinite(ts)) {
    return true;
  }
  return Date.now() - ts >= config.sessionRotateMs;
}

function roleNameNorm(roleName) {
  return String(roleName || '').trim().toLowerCase();
}

function mapUserPayloadFromUserRow(row) {
  const isSuperadmin = roleNameNorm(row.role_name) === 'superadmin';
  const home = row.client_id != null ? String(row.client_id) : null;
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: [row.last_name_1, row.last_name_2].filter(Boolean).join(' ').trim(),
    role: row.role_name,
    roleId: row.role_id,
    clientId: isSuperadmin ? null : home,
    clientName: isSuperadmin ? null : row.client_name,
    homeClientId: home,
    actingClientId: null,
    isSuperadmin,
    needsTenantSelection: isSuperadmin,
    requiresContractAcceptance: false,
  };
}

function mapUserPayloadFromSessionRow(row) {
  const isSuperadmin = roleNameNorm(row.role_name) === 'superadmin';
  const home = row.client_id != null ? String(row.client_id) : null;
  const acting = row.acting_client_id != null ? String(row.acting_client_id) : null;
  const effectiveClientId = isSuperadmin ? acting : home;
  const effectiveClientName = isSuperadmin ? (acting ? row.acting_client_name : null) : row.client_name;
  return {
    id: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: [row.last_name_1, row.last_name_2].filter(Boolean).join(' ').trim(),
    role: row.role_name,
    roleId: row.role_id,
    clientId: effectiveClientId,
    clientName: effectiveClientName,
    homeClientId: home,
    actingClientId: acting,
    isSuperadmin,
    needsTenantSelection: isSuperadmin && !acting,
    requiresContractAcceptance: false,
  };
}

async function findUserWithTenantByEmail(email) {
  const res = await pool.query(
    `SELECT u.id, u.email, u.password_hash, u.is_active, u.client_id, u.role_id,
            u.failed_attempts, u.locked_until,
            u.first_name, u.last_name_1, u.last_name_2,
            c.name AS client_name, c.status AS client_status,
            r.name AS role_name
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     LEFT JOIN clients c ON c.id = u.client_id
     WHERE lower(trim(u.email)) = lower(trim($1))
       AND u.is_active = true
     ORDER BY u.created_at ASC
     LIMIT 1`,
    [email]
  );
  return res.rows[0] || null;
}

async function incrementFailedAttempts(userId) {
  const res = await pool.query(
    `UPDATE users SET
       failed_attempts = failed_attempts + 1,
       locked_until = CASE
         WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3::text)::interval
         ELSE locked_until
       END
     WHERE id = $1
     RETURNING locked_until`,
    [userId, config.maxFailedLogins, `${config.lockoutMinutes} minutes`]
  );

  const lockedUntil = res.rows?.[0]?.locked_until;
  return lockedUntil != null && new Date(lockedUntil) > new Date();
}

async function clearFailedAttempts(userId) {
  await pool.query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
    [userId]
  );
}

async function createSessionRecord({ userId, tokenHash, ip, userAgent }) {
  const res = await pool.query(
    `INSERT INTO sessions (user_id, session_token_hash, expires_at, last_activity, ip_address, user_agent)
     VALUES ($1, $2, NOW() + ($3::text)::interval, NOW(), $4, $5)
     RETURNING id, expires_at, last_activity`,
    [userId, tokenHash, '24 hours', ip || null, userAgent || null]
  );
  return res.rows[0];
}

async function findActiveSessionByTokenHash(tokenHash) {
  const res = await pool.query(
    `SELECT *
     FROM (
       SELECT s.id AS session_id, s.expires_at, s.last_activity, s.revoked_at,
              s.previous_session_token_hash, s.previous_token_expires_at,
              s.ip_address AS session_ip_address,
              s.user_agent AS session_user_agent,
              s.acting_client_id,
              'current' AS token_match_source,
              u.id AS user_id, u.email, u.is_active, u.client_id, u.role_id,
              u.locked_until,
              u.first_name, u.last_name_1, u.last_name_2,
              c.name AS client_name, c.status AS client_status,
              ac.name AS acting_client_name,
              r.name AS role_name
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       INNER JOIN roles r ON r.id = u.role_id
       LEFT JOIN clients c ON c.id = u.client_id
       LEFT JOIN clients ac ON ac.id = s.acting_client_id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()

       UNION ALL

       SELECT s.id AS session_id, s.expires_at, s.last_activity, s.revoked_at,
              s.previous_session_token_hash, s.previous_token_expires_at,
              s.ip_address AS session_ip_address,
              s.user_agent AS session_user_agent,
              s.acting_client_id,
              'previous' AS token_match_source,
              u.id AS user_id, u.email, u.is_active, u.client_id, u.role_id,
              u.locked_until,
              u.first_name, u.last_name_1, u.last_name_2,
              c.name AS client_name, c.status AS client_status,
              ac.name AS acting_client_name,
              r.name AS role_name
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       INNER JOIN roles r ON r.id = u.role_id
       LEFT JOIN clients c ON c.id = u.client_id
       LEFT JOIN clients ac ON ac.id = s.acting_client_id
       WHERE s.previous_session_token_hash = $1
         AND s.previous_token_expires_at IS NOT NULL
         AND s.previous_token_expires_at > NOW()
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
     ) q
     ORDER BY CASE WHEN q.token_match_source = 'current' THEN 0 ELSE 1 END
     LIMIT 1`,
    [tokenHash]
  );
  return res.rows[0] || null;
}

async function getSessionMetaByTokenHash(tokenHash) {
  const res = await pool.query(
    `SELECT s.user_id,
            u.client_id AS client_id
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1 OR s.previous_session_token_hash = $1
     ORDER BY s.created_at DESC
     LIMIT 1`,
    [tokenHash]
  );
  return res.rows[0] || null;
}

async function cleanupSessionsIfDue({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCleanupAtMs < config.sessionCleanupIntervalMs) {
    return;
  }
  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  cleanupInFlight = (async () => {
    try {
      // Limpiamos tokens anteriores ya vencidos (para mantener tabla compacta).
      await pool.query(
        `UPDATE public.sessions
         SET previous_session_token_hash = NULL,
             previous_token_expires_at = NULL
         WHERE previous_token_expires_at IS NOT NULL
           AND previous_token_expires_at <= NOW()`
      );

      // Borrar sesiones caducadas.
      await pool.query(`DELETE FROM public.sessions WHERE expires_at <= NOW()`);

      // Opcional: borrar sesiones revocadas con retención para auditoría mínima.
      const revokedRetentionInterval = `${config.revokedSessionRetentionDays} days`;
      await pool.query(
        `DELETE FROM public.sessions
         WHERE revoked_at IS NOT NULL
           AND revoked_at <= NOW() - ($1::text)::interval`,
        [revokedRetentionInterval]
      );
    } finally {
      lastCleanupAtMs = Date.now();
      cleanupInFlight = null;
    }
  })();

  return cleanupInFlight;
}

async function renewSession(sessionId, expectedTokenHash, { rotate = false } = {}) {
  const activeWhere = `
    id = $1
    AND revoked_at IS NULL
    AND expires_at > NOW()
    AND (
      session_token_hash = $2 OR (
        previous_session_token_hash = $2
        AND previous_token_expires_at IS NOT NULL
        AND previous_token_expires_at > NOW()
      )
    )`;

  if (!rotate) {
    const result = await pool.query(
      `UPDATE sessions
       SET expires_at = NOW() + ($3::text)::interval,
           last_activity = NOW(),
           previous_session_token_hash = CASE
             WHEN previous_token_expires_at IS NOT NULL AND previous_token_expires_at <= NOW()
             THEN NULL
             ELSE previous_session_token_hash
           END,
           previous_token_expires_at = CASE
             WHEN previous_token_expires_at IS NOT NULL AND previous_token_expires_at <= NOW()
             THEN NULL
             ELSE previous_token_expires_at
           END
       WHERE ${activeWhere}
       RETURNING id`,
      [sessionId, expectedTokenHash, '24 hours']
    );
    if (result.rowCount === 0) return { rotated: false, token: null, updated: false };
    return { rotated: false, token: null, updated: true };
  }

  const token = generateSessionToken();
  const tokenHash = sha256Hex(token);

  const result = await pool.query(
    `UPDATE sessions
     SET previous_session_token_hash = session_token_hash,
         previous_token_expires_at = NOW() + ($4::text)::interval,
         session_token_hash = $3,
         expires_at = NOW() + ($5::text)::interval,
         last_activity = NOW()
     WHERE ${activeWhere}
     RETURNING id`,
    [
      sessionId,
      expectedTokenHash,
      tokenHash,
      `${Math.max(1, Math.floor(config.sessionRotationGraceMs / 1000))} seconds`,
      '24 hours',
    ]
  );
  if (result.rowCount === 0) return { rotated: false, token: null, updated: false };
  return { rotated: true, token, updated: true };
}

async function revokeSessionByTokenHash(tokenHash) {
  await pool.query(
    `UPDATE sessions SET revoked_at = NOW()
     WHERE (
            session_token_hash = $1 OR
            previous_session_token_hash = $1
          ) AND revoked_at IS NULL`,
    [tokenHash]
  );
}

async function login({ email, password, ip, userAgent }) {
  // Limpieza eventual para mantener `sessions` bajo control.
  cleanupSessionsIfDue().catch(() => {});

  const normalizedEmail = String(email || '').trim();
  const row = await findUserWithTenantByEmail(normalizedEmail);

  if (row && row.locked_until) {
    const lu = new Date(row.locked_until);
    if (lu <= new Date()) {
      await clearFailedAttempts(row.id);
      row.locked_until = null;
    }
  }

  const hashToCompare = row ? row.password_hash : DUMMY_PASSWORD_HASH;
  const passwordOk = await bcrypt.compare(String(password || ''), hashToCompare);

  if (row && row.locked_until && new Date(row.locked_until) > new Date()) {
    await auditService.logSecurityEvent({
      eventType: 'login_locked',
      userId: row.id,
      clientId: row.client_id,
      identifier: normalizedEmail,
      ipAddress: ip,
      userAgent,
      metadata: { lockoutMinutes: config.lockoutMinutes },
    });

    const err = new Error(
      'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.'
    );
    err.code = 'LOCKED';
    err.status = 423;
    throw err;
  }

  if (!row || !passwordOk) {
    if (row) {
      const lockedNow = await incrementFailedAttempts(row.id);
      await auditService.logSecurityEvent({
        eventType: lockedNow ? 'login_blocked' : 'login_failed',
        userId: row.id,
        clientId: row.client_id,
        identifier: normalizedEmail,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'invalid_credentials' },
      });
      if (lockedNow) {
        await auditService.logSecurityEvent({
          eventType: 'login_failed',
          userId: row.id,
          clientId: row.client_id,
          identifier: normalizedEmail,
          ipAddress: ip,
          userAgent,
          metadata: { reason: 'invalid_credentials', blockedNow: true },
        });
      }
    } else {
      await auditService.logSecurityEvent({
        eventType: 'login_failed',
        userId: null,
        clientId: null,
        identifier: normalizedEmail,
        ipAddress: ip,
        userAgent,
        metadata: { reason: 'invalid_credentials' },
      });
    }
    const err = new Error('Credenciales inválidas.');
    err.code = 'AUTH_FAILED';
    throw err;
  }

  if (!row.is_active) {
    const lockedNow = await incrementFailedAttempts(row.id);
    await auditService.logSecurityEvent({
      eventType: lockedNow ? 'login_blocked' : 'login_failed',
      userId: row.id,
      clientId: row.client_id,
      identifier: normalizedEmail,
      ipAddress: ip,
      userAgent,
      metadata: { reason: 'user_inactive' },
    });
    const err = new Error('Credenciales inválidas.');
    err.code = 'AUTH_FAILED';
    throw err;
  }

  const isSuperadmin = roleNameNorm(row.role_name) === 'superadmin';
  if (!isSuperadmin && String(row.client_status || '').toLowerCase() !== 'active') {
    const lockedNow = await incrementFailedAttempts(row.id);
    await auditService.logSecurityEvent({
      eventType: lockedNow ? 'login_blocked' : 'login_failed',
      userId: row.id,
      clientId: row.client_id,
      identifier: normalizedEmail,
      ipAddress: ip,
      userAgent,
      metadata: { reason: 'client_inactive' },
    });
    const err = new Error('Credenciales inválidas.');
    err.code = 'AUTH_FAILED';
    throw err;
  }

  await clearFailedAttempts(row.id);

  if (config.revokeExistingSessionsOnLogin) {
    await pool.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [row.id]
    );
  }

  const token = generateSessionToken();
  const tokenHash = sha256Hex(token);
  await createSessionRecord({
    userId: row.id,
    tokenHash,
    ip,
    userAgent,
  });

  const user = mapUserPayloadFromUserRow(row);
  await auditService.logSecurityEvent({
    eventType: 'login_success',
    userId: row.id,
    clientId: row.client_id,
    identifier: normalizedEmail,
    ipAddress: ip,
    userAgent,
    metadata: { roleId: row.role_id },
  });
  return { token, user };
}

function assertNewPasswordPlain(value) {
  return assertPasswordPolicy(value);
}

/**
 * Cambio de contraseña por el propio usuario. Cierra otras sesiones activas del mismo usuario.
 * @param {{ userId: string, homeClientId: string|null, currentPasswordPlain, newPasswordPlain, keepSessionId, ip, userAgent }} params
 */
async function changeOwnPassword({
  userId,
  homeClientId,
  currentPasswordPlain,
  newPasswordPlain,
  keepSessionId,
  ip,
  userAgent,
}) {
  const current = String(currentPasswordPlain ?? '');
  if (!current) {
    const err = new Error('La contraseña actual es obligatoria.');
    err.status = 400;
    throw err;
  }
  const newPwd = assertNewPasswordPlain(newPasswordPlain);
  if (newPwd === current) {
    const err = new Error('La nueva contraseña debe ser distinta de la actual.');
    err.status = 400;
    throw err;
  }

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const u = await db.query(
      `SELECT id, password_hash
       FROM users
       WHERE id = $1
         AND (client_id IS NOT DISTINCT FROM $2::uuid)
         AND is_active = true
       FOR UPDATE`,
      [userId, homeClientId]
    );
    const row = u.rows[0];
    if (!row) {
      const err = new Error('Usuario no encontrado.');
      err.status = 404;
      throw err;
    }
    const passwordOk = await bcrypt.compare(current, row.password_hash);
    if (!passwordOk) {
      const err = new Error('La contraseña actual no es correcta.');
      err.status = 400;
      err.code = 'BAD_CURRENT_PASSWORD';
      throw err;
    }
    const hash = await bcrypt.hash(newPwd, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE users
       SET password_hash = $1,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE id = $2
         AND (client_id IS NOT DISTINCT FROM $3::uuid)`,
      [hash, userId, homeClientId]
    );
    await db.query(
      `UPDATE sessions s
       SET revoked_at = NOW()
       FROM users u
       WHERE s.user_id = u.id
         AND u.id = $1
         AND (u.client_id IS NOT DISTINCT FROM $2::uuid)
         AND s.revoked_at IS NULL
         AND s.id <> $3::uuid`,
      [userId, homeClientId, keepSessionId]
    );
    await db.query('COMMIT');

    await auditService.logSecurityEvent({
      eventType: 'password_changed',
      userId,
      clientId: homeClientId || null,
      ipAddress: ip,
      userAgent,
      metadata: {},
    });
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}

async function requestPasswordReset({ email, targetUserId, sessionRow, ip, userAgent }) {
  let targetUser = null;

  if (targetUserId != null && String(targetUserId).trim() && sessionRow) {
    const roleNorm = String(sessionRow.role_name || '').trim().toLowerCase();
    const isSuperadmin = roleNorm === 'superadmin';
    if (roleNorm !== 'admin' && !isSuperadmin) {
      const err = new Error('Solo un administrador puede solicitar el enlace para otro usuario.');
      err.status = 403;
      throw err;
    }
    const effectiveClientId = isSuperadmin
      ? sessionRow.acting_client_id
      : sessionRow.client_id;
    if (isSuperadmin && (effectiveClientId == null || !String(effectiveClientId).trim())) {
      const err = new Error('Seleccione una organización antes de solicitar recuperación para un usuario.');
      err.status = 400;
      throw err;
    }
    const uid = String(targetUserId).trim();
    const r = await pool.query(
      `SELECT u.id, u.email, u.first_name, u.client_id
       FROM users u
       INNER JOIN clients c ON c.id = u.client_id
       WHERE u.id = $1::uuid AND u.client_id = $2::uuid AND u.is_active = true
         AND lower(trim(c.status)) = 'active'`,
      [uid, effectiveClientId]
    );
    targetUser = r.rows[0] || null;
    if (!targetUser) {
      const err = new Error('Usuario no encontrado o no pertenece a su organización.');
      err.status = 404;
      throw err;
    }
  } else {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
      const err = new Error('El correo electrónico es obligatorio.');
      err.status = 400;
      throw err;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      const err = new Error('Indique un correo electrónico válido.');
      err.status = 400;
      throw err;
    }
    targetUser = await findUserWithTenantByEmail(normalized);
    if (!targetUser) {
      return { ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
    }
  }

  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(plainToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [targetUser.id]
    );
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [targetUser.id, tokenHash, expiresAt]
    );
    await db.query('COMMIT');
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    db.release();
  }

  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink = `${String(baseUrl).replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(plainToken)}`;

  try {
    await mailService.sendPasswordResetEmail({
      to: targetUser.email,
      resetLink,
      firstName: targetUser.first_name,
    });
  } catch (e) {
    try {
      await pool.query(
        `UPDATE password_reset_tokens SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND token_hash = $2`,
        [targetUser.id, tokenHash]
      );
    } catch {
      /* ignore */
    }
    throw e;
  }

  await auditService.logSecurityEvent({
    eventType: 'password_reset_requested',
    userId: targetUser.id,
    clientId: targetUser.client_id,
    identifier: targetUser.email,
    ipAddress: ip,
    userAgent,
    metadata: { via: targetUserId && sessionRow ? 'admin' : 'self_service' },
  });

  return { ok: true, message: PASSWORD_RESET_GENERIC_MESSAGE };
}

async function resetPasswordWithToken({ token, newPasswordPlain, ip, userAgent }) {
  const plain = String(token || '').trim();
  if (!plain) {
    const err = new Error('Token inválido.');
    err.status = 400;
    throw err;
  }
  const newPwd = assertPasswordPolicy(newPasswordPlain);
  const tokenHash = sha256Hex(plain);

  const db = await pool.connect();
  let userId = null;
  let clientId = null;
  try {
    await db.query('BEGIN');
    const tr = await db.query(
      `SELECT prt.id, prt.user_id, u.client_id
       FROM password_reset_tokens prt
       INNER JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL AND prt.expires_at > NOW()
       FOR UPDATE OF prt`,
      [tokenHash]
    );
    const row = tr.rows[0];
    if (!row) {
      const err = new Error('El enlace no es válido o ya expiró.');
      err.status = 400;
      throw err;
    }
    userId = row.user_id;
    clientId = row.client_id;
    const passwordHash = await bcrypt.hash(newPwd, BCRYPT_ROUNDS);
    await db.query(
      `UPDATE users
       SET password_hash = $1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, userId]
    );
    await db.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);
    await db.query(
      `UPDATE password_reset_tokens SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL AND id <> $2::uuid`,
      [userId, row.id]
    );
    await db.query(
      `UPDATE sessions SET revoked_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    await db.query('COMMIT');
  } catch (e) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    db.release();
  }

  await auditService.logSecurityEvent({
    eventType: 'password_reset_completed',
    userId,
    clientId,
    ipAddress: ip,
    userAgent,
    metadata: {},
  });

  return { ok: true };
}

/**
 * Superadmin: fija el tenant visto en esta sesión.
 */
async function setSessionActingClient({ sessionId, superadminUserId, actingClientId }) {
  const res = await pool.query(
    `UPDATE sessions s
     SET acting_client_id = $3
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE s.id = $1::uuid
       AND s.user_id = u.id
       AND u.id = $2::uuid
       AND lower(trim(r.name)) = 'superadmin'
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND EXISTS (
         SELECT 1 FROM clients c
         WHERE c.id = $3::uuid
           AND lower(trim(coalesce(c.status, ''))) = 'active'
       )
     RETURNING s.id`,
    [sessionId, superadminUserId, actingClientId]
  );
  return res.rowCount > 0;
}

/**
 * Superadmin: deja de ver un tenant en esta sesión.
 */
async function clearSessionActingClient({ sessionId, superadminUserId }) {
  const res = await pool.query(
    `UPDATE sessions s
     SET acting_client_id = NULL
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE s.id = $1::uuid
       AND s.user_id = u.id
       AND u.id = $2::uuid
       AND lower(trim(r.name)) = 'superadmin'
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
     RETURNING s.id`,
    [sessionId, superadminUserId]
  );
  return res.rowCount > 0;
}

module.exports = {
  sha256Hex,
  login,
  changeOwnPassword,
  requestPasswordReset,
  resetPasswordWithToken,
  findActiveSessionByTokenHash,
  shouldRotateSession,
  cleanupSessionsIfDue,
  renewSession,
  revokeSessionByTokenHash,
  getSessionMetaByTokenHash,
  mapUserPayloadFromSessionRow,
  mapUserPayloadFromUserRow,
  setSessionActingClient,
  clearSessionActingClient,
};
