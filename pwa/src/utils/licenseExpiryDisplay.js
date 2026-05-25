/**
 * dd-mm-yyyy desde YYYY-MM-DD (solo calendario, sin Date local).
 */
export function formatIsoDateDisplay(iso) {
  const s = String(iso || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Texto de vencimiento para el pie del dashboard (API puede enviar solo licenseExpiresOn).
 */
export function licenseExpiryDisplayForUser(user) {
  if (!user) return null;
  if (user.licenseExpiresOnDisplay) return user.licenseExpiresOnDisplay;
  return formatIsoDateDisplay(user.licenseExpiresOn);
}

/**
 * Fecha de vencimiento en listados superadmin (ISO o ISO datetime JSON).
 */
export function formatLicenseDateFromApi(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const fromIso = formatIsoDateDisplay(value);
    if (fromIso) return fromIso;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return formatIsoDateDisplay(`${y}-${mo}-${d}`);
  }
  return null;
}
