const config = require('../config');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
const clientLicenseService = require('../services/client-license.service');

function clientIp(req) {
  const x = req.headers['x-forwarded-for'];
  if (typeof x === 'string' && x.length) {
    return x.split(',')[0].trim();
  }
  return req.socket.remoteAddress || null;
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionCookieMaxAgeMs,
    path: '/',
  };
}

function setSessionCookie(res, token) {
  res.cookie(config.sessionCookieName, token, sessionCookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(config.sessionCookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
  });
}

/**
 * Validates `sid` cookie, tenant + role joins, idle timeout; renews DB session and refreshes cookie TTL.
 */
async function requireAuth(req, res, next) {
  // Housekeeping ocasional para evitar crecimiento infinito de `sessions`.
  try {
    authService.cleanupSessionsIfDue().catch(() => {});
  } catch {
    // Si falla, no bloqueamos el flujo de autenticación.
  }

  const raw = req.cookies?.[config.sessionCookieName];
  if (!raw || typeof raw !== 'string') {
    return res.status(401).json({ message: 'No autenticado.' });
  }

  const tokenHash = authService.sha256Hex(raw);
  let row;
  try {
    row = await authService.findActiveSessionByTokenHash(tokenHash);
  } catch (e) {
    console.error('requireAuth session lookup', e);
    return res.status(500).json({ message: 'Error al validar la sesión.' });
  }

  if (!row) {
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Sesión inválida o expirada.' });
  }

  if (row.locked_until != null) {
    const lockedUntil =
      row.locked_until instanceof Date
        ? row.locked_until.getTime()
        : new Date(row.locked_until).getTime();

    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
      try {
        await authService.revokeSessionByTokenHash(tokenHash);
      } catch (e) {
        console.error('requireAuth locked user revoke', e);
      }
      clearSessionCookie(res);
      return res.status(403).json({ message: 'Sesión inválida.' });
    }
  }

  // Defense-in-depth: aunque el query ya filtra expires_at y revoked_at,
  // validamos explícitamente para cubrir estados inesperados.
  if (row.revoked_at != null) {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth revoked revoke', e);
    }
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Sesión inválida.' });
  }

  const expiresAt =
    row.expires_at instanceof Date
      ? row.expires_at.getTime()
      : new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth expires revoke', e);
    }
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Sesión expirada.' });
  }

  const lastActivity =
    row.last_activity instanceof Date
      ? row.last_activity.getTime()
      : new Date(row.last_activity).getTime();
  if (!Number.isFinite(lastActivity)) {
    // Si por migraciones antiguas quedara NULL/dañado, no permitimos sesión.
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth invalid last_activity revoke', e);
    }
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Sesión inválida.' });
  }

  if (Date.now() - lastActivity > config.sessionIdleMs) {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth idle revoke', e);
    }
    clearSessionCookie(res);
    auditService.logSecurityEvent({
      eventType: 'session_idle_timeout',
      userId: row.user_id,
      clientId: row.client_id,
      ipAddress: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata: { idleMs: config.sessionIdleMs },
    });
    return res.status(401).json({ message: 'Sesión cerrada por inactividad.' });
  }

  if (!row.is_active) {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth inactive user revoke', e);
    }
    clearSessionCookie(res);
    return res.status(403).json({ message: 'Usuario inactivo.' });
  }

  const isSuperadminSession = String(row.role_name || '').trim().toLowerCase() === 'superadmin';
  const licenseSource = isSuperadminSession
    ? row.acting_client_id
      ? { status: row.acting_client_status, license_expires_on: row.acting_license_expires_on }
      : null
    : { status: row.client_status, license_expires_on: row.license_expires_on };

  if (licenseSource && clientLicenseService.isClientLicenseExpired(licenseSource)) {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth license expired revoke', e);
    }
    clearSessionCookie(res);
    return res.status(403).json({ message: 'Licencia vencida.', code: 'LICENSE_EXPIRED' });
  }

  if (!isSuperadminSession && String(row.client_status || '').toLowerCase() !== 'active') {
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('requireAuth inactive client revoke', e);
    }
    clearSessionCookie(res);
    return res.status(403).json({ message: 'Cliente no disponible.' });
  }

  // Anti session theft / suspicious change detection (optional, configurable).
  try {
    const currentIp = clientIp(req);
    const currentUa = req.headers['user-agent'] || null;

    const checkUA = config.sessionBindingCheckUserAgent;
    const checkIp = config.sessionBindingCheckIp;

    const uaMismatch =
      checkUA &&
      row.session_user_agent != null &&
      currentUa != null &&
      String(row.session_user_agent) !== String(currentUa);

    const ipMismatch =
      checkIp &&
      row.session_ip_address != null &&
      currentIp != null &&
      String(row.session_ip_address) !== String(currentIp);

    let revokeFingerprint = false;
    if (checkUA && checkIp) {
      if (String(config.sessionBindingRevokeMode).toLowerCase() === 'either') {
        revokeFingerprint = !!(uaMismatch || ipMismatch);
      } else {
        revokeFingerprint = !!(uaMismatch && ipMismatch);
      }
    } else if (checkUA) {
      revokeFingerprint = !!uaMismatch;
    } else if (checkIp) {
      revokeFingerprint = !!ipMismatch;
    }

    if (revokeFingerprint) {
      try {
        await authService.revokeSessionByTokenHash(tokenHash);
      } catch (e) {
        console.error('requireAuth fingerprint revoke', e);
      }
      clearSessionCookie(res);

      auditService.logSecurityEvent({
        eventType: 'session_fingerprint_mismatch',
        userId: row.user_id,
        clientId: row.client_id,
        ipAddress: currentIp,
        userAgent: currentUa,
        metadata: {
          uaMismatch,
          ipMismatch,
          checkUA,
          checkIp,
        },
      });
      return res.status(401).json({ message: 'Sesión inválida.' });
    }
  } catch (e) {
    // No bloqueamos si el chequeo fingerprint falla.
    console.error('requireAuth fingerprint check error', e);
  }

  const rotate = authService.shouldRotateSession(row.last_activity);
  const shouldForceRotateOldToken = row.token_match_source === 'previous';
  const effectiveRotate = shouldForceRotateOldToken || rotate;

  let renewal;
  try {
    renewal = await authService.renewSession(row.session_id, tokenHash, {
      rotate: effectiveRotate,
    });
  } catch (e) {
    console.error('requireAuth renew', e);
    return res.status(500).json({ message: 'Error al renovar la sesión.' });
  }
  if (!renewal?.updated) {
    clearSessionCookie(res);
    return res.status(401).json({ message: 'Sesión inválida.' });
  }

  setSessionCookie(res, renewal?.rotated ? renewal.token : raw);

  req.auth = {
    sessionId: row.session_id,
    tokenHash: renewal?.rotated ? authService.sha256Hex(renewal.token) : tokenHash,
    user: authService.mapUserPayloadFromSessionRow(row),
  };
  req.user = req.auth.user;
  return next();
}

module.exports = {
  requireAuth,
  clientIp,
  setSessionCookie,
  clearSessionCookie,
  sessionCookieOptions,
};
