/** Misma política que api/src/lib/passwordPolicy.js (validación en cliente). */

export const MIN_PASSWORD_LEN = 6;

export const PASSWORD_POLICY_SUMMARY =
  'Mínimo 6 caracteres, con al menos una letra, un número, un carácter especial y una mayúscula.';

const RE_LETTER = /[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]/;
const RE_UPPER = /[A-ZÁÉÍÓÚÑÜ]/;
const RE_DIGIT = /\d/;
const RE_SPECIAL = /[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ]/;

export function validatePasswordPolicy(plain) {
  const s = String(plain ?? '');
  if (!s) return 'La contraseña es obligatoria.';
  if (s.length < MIN_PASSWORD_LEN) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LEN} caracteres.`;
  }
  if (!RE_LETTER.test(s)) {
    return 'La contraseña debe incluir al menos una letra.';
  }
  if (!RE_UPPER.test(s)) {
    return 'La contraseña debe incluir al menos una letra mayúscula.';
  }
  if (!RE_DIGIT.test(s)) {
    return 'La contraseña debe incluir al menos un número.';
  }
  if (!RE_SPECIAL.test(s)) {
    return 'La contraseña debe incluir al menos un carácter especial.';
  }
  return null;
}
