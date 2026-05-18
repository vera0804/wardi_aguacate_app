/**
 * @param {string[]} allowedRoles role names (case-insensitive), e.g. ['admin', 'operario'].
 * Para permitir acceso en modo soporte con organización elegida, incluir explícitamente `'superadmin'`.
 */
function requireRoles(allowedRoles) {
  const allowed = new Set(allowedRoles.map((r) => String(r || '').trim().toLowerCase()));
  return function requireRolesMiddleware(req, res, next) {
    const role = String(req.user?.role || '').trim().toLowerCase();
    if (role === 'superadmin') {
      if (!req.user?.actingClientId) {
        return res.status(400).json({
          message: 'Seleccione una organización para acceder a esta sección.',
          code: 'TENANT_REQUIRED',
        });
      }
      if (!allowed.has('superadmin')) {
        return res.status(403).json({
          message: 'Este recurso no está habilitado para soporte de plataforma.',
          code: 'SUPERADMIN_ROUTE_DENIED',
        });
      }
      return next();
    }
    if (!allowed.has(role)) {
      return res.status(403).json({ message: 'No tienes permiso para esta sección.' });
    }
    return next();
  };
}

function requireSuperadmin(req, res, next) {
  if (String(req.user?.role || '').trim().toLowerCase() !== 'superadmin') {
    return res.status(403).json({ message: 'Solo personal de plataforma puede acceder.' });
  }
  return next();
}

/** Bloquea mutaciones para rol `operario` (solo lectura). Admin y superadmin pueden escribir. */
function requireWritePermission(req, res, next) {
  const role = String(req.user?.role || '').trim().toLowerCase();
  if (role === 'operario') {
    return res.status(403).json({ message: 'Tu rol solo tiene permisos de lectura.' });
  }
  return next();
}

const { bindTenantRlsContext } = require('./tenant-rls.middleware');

/**
 * Rutas multitenant: exige `req.user.clientId` (para superadmin, la org. en sesión).
 * Evita duplicar lógica de `requireRoles` cuando se permiten roles distintos por ruta.
 */
function requireEffectiveClient(req, res, next) {
  const role = String(req.user?.role || '').trim().toLowerCase();
  if (role === 'superadmin' && !req.user?.actingClientId) {
    return res.status(400).json({
      message: 'Seleccione una organización para acceder a esta sección.',
      code: 'TENANT_REQUIRED',
    });
  }
  const cid = req.user?.clientId;
  if (cid == null || !String(cid).trim()) {
    return res.status(400).json({
      message: 'Organización no disponible en esta sesión.',
      code: 'TENANT_REQUIRED',
    });
  }
  return bindTenantRlsContext(req, res, next);
}

module.exports = {
  requireRoles,
  requireSuperadmin,
  requireEffectiveClient,
  requireWritePermission,
};
