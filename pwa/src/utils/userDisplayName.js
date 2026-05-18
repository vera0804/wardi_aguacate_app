/**
 * Nombre visible del usuario en la interfaz (cabecera, pie de sesión).
 * Usa nombre y apellidos; si no hay, el correo.
 */
export function getUserDisplayName(user) {
  if (!user) return '';
  const first = String(user.firstName || '').trim();
  const last = String(user.lastName || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  return String(user.email || '').trim();
}
