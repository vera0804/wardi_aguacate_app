/** Quita marcas diacríticas (NFD + quitar combining) para comparar sin tildes. */
export function foldDiacritics(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Nombre canónico: sin tildes, primera letra mayúscula y el resto minúsculas (locale es). */
export function formatAssetCategoryName(value) {
  const folded = foldDiacritics(String(value ?? '').normalize('NFC').trim());
  if (!folded) return '';
  const lower = folded.toLocaleLowerCase('es');
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1);
}

/** Clave para comparar / filtrar categorías (sin tildes, minúsculas). */
export function categoryNameKey(value) {
  return foldDiacritics(String(value ?? '').trim()).toLocaleLowerCase('es');
}
