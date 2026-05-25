const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../services/auth.service');
const {
  requireAuth,
  clientIp,
  setSessionCookie,
  clearSessionCookie,
} = require('../middleware/auth.middleware');
const { ensureCsrfCookie, requireCsrf } = require('../middleware/csrf.middleware');
const config = require('../config');

const router = express.Router();

const rateLimitMessage = {
  message: 'Demasiados intentos de inicio de sesión. Intenta más tarde.',
};

function keyByIp(req) {
  return `ip:${clientIp(req) || 'unknown'}`;
}

function keyByUser(req) {
  const emailOrIdentifier = readEmail(req.body || {});
  if (!emailOrIdentifier) return 'user:unknown';
  const normalized = String(emailOrIdentifier).toLowerCase().trim();
  return `user:${authService.sha256Hex(normalized)}`;
}

const loginLimiterByIp = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMaxByIp,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: rateLimitMessage,
});

const loginLimiterByUser = rateLimit({
  windowMs: config.loginRateLimitWindowMs,
  max: config.loginRateLimitMaxByUser,
  keyGenerator: keyByUser,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: rateLimitMessage,
});

const passwordResetRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.PASSWORD_RESET_REQUEST_MAX_PER_HOUR || 8),
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiadas solicitudes de recuperación. Intenta más tarde.' },
});

const passwordResetConsumeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.PASSWORD_RESET_CONSUME_MAX_PER_HOUR || 30),
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Demasiados intentos. Intenta más tarde.' },
});

function readEmail(body) {
  if (body.email != null && String(body.email).trim()) {
    return String(body.email).trim();
  }
  if (body.identifier != null && String(body.identifier).trim()) {
    return String(body.identifier).trim();
  }
  return '';
}

/** Sesión opcional (sin 401): permite que un admin use user_id en recuperación. */
async function maybeAttachSessionRow(req, res, next) {
  req.sessionRow = null;
  const raw = req.cookies?.[config.sessionCookieName];
  if (!raw || typeof raw !== 'string') return next();
  try {
    const row = await authService.findActiveSessionByTokenHash(authService.sha256Hex(raw));
    if (!row || row.revoked_at) return next();
    const isSuperadminSession = String(row.role_name || '').trim().toLowerCase() === 'superadmin';
    if (!row.is_active || (!isSuperadminSession && String(row.client_status || '').toLowerCase() !== 'active'))
      return next();
    const lastActivity = new Date(row.last_activity).getTime();
    if (!Number.isFinite(lastActivity) || Date.now() - lastActivity > config.sessionIdleMs) return next();
    if (row.locked_until != null) {
      const lu = new Date(row.locked_until).getTime();
      if (Number.isFinite(lu) && lu > Date.now()) return next();
    }
    req.sessionRow = row;
  } catch {
    /* ignore */
  }
  return next();
}

router.get('/csrf', (req, res) => {
  const token = ensureCsrfCookie(res);
  return res.json({ csrfToken: token });
});

// Endpoints POST sensibles con CSRF real.
router.post('/login', loginLimiterByIp, loginLimiterByUser, requireCsrf, async (req, res) => {
  const email = readEmail(req.body || {});
  const password = req.body?.password;

  if (!email || !password) {
    return res.status(400).json({ message: 'Correo y contraseña son obligatorios.' });
  }

  try {
    const { token, user } = await authService.login({
      email,
      password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    setSessionCookie(res, token);
    return res.status(200).json(user);
  } catch (err) {
    if (err?.code === 'LICENSE_EXPIRED') {
      return res.status(403).json({ message: err.message, code: 'LICENSE_EXPIRED' });
    }
    if (err?.code === 'LOCKED' || err?.code === 'AUTH_FAILED') {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }
    if (err?.status && err.status < 500) {
      return res.status(err.status).json({ message: err.message });
    }
    console.error('POST /auth/login', err);
    return res.status(500).json({ message: 'No se pudo iniciar sesión.' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  return res.json(req.user);
});

router.post('/change-password', requireCsrf, requireAuth, async (req, res) => {
  try {
    await authService.changeOwnPassword({
      userId: req.user.id,
      homeClientId: req.user.homeClientId ?? null,
      currentPasswordPlain: req.body?.current_password,
      newPasswordPlain: req.body?.new_password,
      keepSessionId: req.auth.sessionId,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    return res.status(204).end();
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) {
      console.error('POST /auth/change-password', err);
    }
    return res
      .status(status)
      .json({ message: err?.message || 'No se pudo cambiar la contraseña.' });
  }
});

router.post(
  '/request-password-reset',
  passwordResetRequestLimiter,
  requireCsrf,
  maybeAttachSessionRow,
  async (req, res) => {
    const { email, user_id } = req.body || {};
    if (user_id != null && String(user_id).trim() && !req.sessionRow) {
      return res.status(403).json({ message: 'No autorizado.' });
    }
    try {
      const data = await authService.requestPasswordReset({
        email,
        targetUserId: user_id,
        sessionRow: req.sessionRow,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'] || null,
      });
      return res.json(data);
    } catch (err) {
      const status = Number(err?.status) || 500;
      if (status >= 500) {
        console.error('POST /auth/request-password-reset', err);
      }
      return res.status(status).json({ message: err?.message || 'No se pudo procesar la solicitud.' });
    }
  }
);

router.post('/reset-password', passwordResetConsumeLimiter, requireCsrf, async (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || !new_password) {
    return res.status(400).json({ message: 'Token y nueva contraseña son obligatorios.' });
  }
  try {
    await authService.resetPasswordWithToken({
      token,
      newPasswordPlain: new_password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    return res.status(204).end();
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) {
      console.error('POST /auth/reset-password', err);
    }
    return res.status(status).json({ message: err?.message || 'No se pudo restablecer la contraseña.' });
  }
});

router.post('/logout', requireCsrf, async (req, res) => {
  const raw = req.cookies?.[config.sessionCookieName];
  const ip = clientIp(req);
  const userAgent = req.headers['user-agent'] || null;
  if (raw && typeof raw === 'string') {
    const tokenHash = authService.sha256Hex(raw);
    try {
      await authService.revokeSessionByTokenHash(tokenHash);
    } catch (e) {
      console.error('POST /auth/logout', e);
    }
    try {
      const meta = await authService.getSessionMetaByTokenHash(tokenHash);
      const auditService = require('../services/audit.service');
      auditService.logSecurityEvent({
        eventType: 'logout',
        userId: meta?.user_id || null,
        clientId: meta?.client_id || null,
        ipAddress: ip,
        userAgent,
      });
    } catch {
      // never block logout
    }
  }
  clearSessionCookie(res);
  return res.status(204).end();
});

module.exports = router;
