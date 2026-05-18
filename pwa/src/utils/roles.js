/** Roles que entran al panel en `/admin`. */
const ADMIN_AREA_ROLES = ['admin', 'operario'];
export function isAdminAreaRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return ADMIN_AREA_ROLES.includes(r);
}
