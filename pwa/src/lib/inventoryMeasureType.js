/** Opciones de tipo de medida en UI; en BD se guarda la unidad base correspondiente. */
export const MEASURE_TYPE_OPTIONS = [
  { value: 'masa', label: 'Masa', unit: 'kg', hint: 'Ej. saco de fertilizante de 50 kg' },
  { value: 'volumen', label: 'Volumen', unit: 'litro', hint: 'Ej. fertilizante líquido' },
  { value: 'unidad', label: 'Unidad', unit: 'unidad', hint: 'Ej. árboles' },
];

const UNIT_TO_MEASURE_TYPE = {
  kg: 'masa',
  litro: 'volumen',
  unidad: 'unidad',
};

const MEASURE_TYPE_TO_UNIT = {
  masa: 'kg',
  volumen: 'litro',
  unidad: 'unidad',
};

export function unitToMeasureType(unit) {
  return UNIT_TO_MEASURE_TYPE[String(unit || '').trim().toLowerCase()] || 'unidad';
}

export function measureTypeToUnit(measureType) {
  return MEASURE_TYPE_TO_UNIT[String(measureType || '').trim().toLowerCase()] || null;
}

export function measureTypeLabel(measureTypeOrUnit) {
  const key = UNIT_TO_MEASURE_TYPE[measureTypeOrUnit]
    ? UNIT_TO_MEASURE_TYPE[measureTypeOrUnit]
    : measureTypeOrUnit;
  return MEASURE_TYPE_OPTIONS.find((o) => o.value === key)?.label || measureTypeOrUnit;
}

export function measureTypeHint(measureType) {
  return MEASURE_TYPE_OPTIONS.find((o) => o.value === measureType)?.hint || '';
}
