const crypto = require('crypto');
const config = require('../config');

const CSRF_COOKIE_NAME = 'csrf_token';

function generateCsrfToken() {
  // Double-submit cookie: el servidor valida header vs cookie, sin guardar estado.
  return crypto.randomBytes(32).toString('hex');
}

function csrfCookieOptions() {
  return {
    httpOnly: false, // Necesario para que el frontend lo lea y lo envíe en el header.
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24h
  };
}

function ensureCsrfCookie(res) {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, csrfCookieOptions());
  return token;
}

function readCsrfCookie(req) {
  const v = req.cookies?.[CSRF_COOKIE_NAME];
  return typeof v === 'string' ? v : null;
}

function readCsrfHeader(req) {
  const v = req.headers['x-csrf-token'];
  return typeof v === 'string' ? v : null;
}

function requireCsrf(req, res, next) {
  // Solo aplicamos en endpoints sensibles (POST).
  const cookieToken = readCsrfCookie(req);
  const headerToken = readCsrfHeader(req);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ message: 'CSRF inválido.' });
  }
  return next();
}

module.exports = {
  CSRF_COOKIE_NAME,
  ensureCsrfCookie,
  requireCsrf,
};

