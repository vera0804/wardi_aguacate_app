/**
 * Política de contraseña (crear usuario, editar, recuperar, cambiar).
 * Mínimo 6 caracteres; al menos una letra, un número, un carácter especial y una mayúscula.
 */

const MIN_LEN = 6;

const RE_LETTER = /[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]/;
const RE_UPPER = /[A-ZÁÉÍÓÚÑÜ]/;
const RE_DIGIT = /\d/;
const RE_SPECIAL = /[^a-zA-Z0-9áéíóúñüÁÉÍÓÚÑÜ]/;

const PASSWORD_POLICY_SUMMARY =
  'Mínimo 6 caracteres, con al menos una letra, un número, un carácter especial y una mayúscula.';

function validatePasswordPolicy(plain) {
  const s = String(plain ?? '');
  if (!s) return 'La contraseña es obligatoria.';
  if (s.length < MIN_LEN) {
    return `La contraseña debe tener al menos ${MIN_LEN} caracteres.`;
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

function assertPasswordPolicy(plain) {
  const msg = validatePasswordPolicy(plain);
  if (msg) {
    const err = new Error(msg);
    err.status = 400;
    throw err;
  }
  return String(plain);
}

module.exports = {
  MIN_LEN,
  PASSWORD_POLICY_SUMMARY,
  validatePasswordPolicy,
  assertPasswordPolicy,
};
