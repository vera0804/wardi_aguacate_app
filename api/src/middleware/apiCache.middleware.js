/**
 * Evita que proxies o clientes cacheen respuestas JSON de /api (cookies de sesión).
 * Excepción deliberada: /api/health para healthchecks rápidos.
 */
function apiPrivateNoStore(req, res, next) {
  const bare = String(req.originalUrl || '').split('?')[0];
  if (bare === '/api/health') {
    res.setHeader('Cache-Control', 'no-store');
    return next();
  }
  if (bare.startsWith('/api')) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Pragma', 'no-cache');
  }
  return next();
}

module.exports = { apiPrivateNoStore };
