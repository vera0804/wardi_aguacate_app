/** 1 litro = 33,81 onzas líquidas (fl oz). */
const FL_OZ_PER_LITER = 33.81;
/** 1 kg = 35,274 onzas de masa (oz). */
const OZ_MASS_PER_KG = 35.274;

const UNIT_ALIASES = {
  cc: 'cc',
  ml: 'cc',
  ccs: 'cc',
  litro: 'litro',
  litros: 'litro',
  l: 'litro',
  lt: 'litro',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogramo: 'kg',
  kilogramos: 'kg',
  gramo: 'gramo',
  gramos: 'gramo',
  g: 'gramo',
  onza_liquida: 'onza_liquida',
  onza_liquidas: 'onza_liquida',
  onzas_liquidas: 'onza_liquida',
  'onza_líquida': 'onza_liquida',
  'onzas_líquidas': 'onza_liquida',
  fl_oz: 'onza_liquida',
  floz: 'onza_liquida',
  oz_liquida: 'onza_liquida',
  onza_masa: 'onza_masa',
  onza_masas: 'onza_masa',
  onzas_masa: 'onza_masa',
  'onza_de_masa': 'onza_masa',
  oz_masa: 'onza_masa',
  onza: 'onza',
  onzas: 'onza',
  oz: 'onza',
  unidad: 'unidad',
  unidades: 'unidad',
  und: 'unidad',
  un: 'unidad',
};

function round3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
}

function round6(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function normalizeUnit(value, field = 'unit') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) {
    const err = new Error(`${field} es obligatorio.`);
    err.status = 400;
    throw err;
  }
  return UNIT_ALIASES[raw] || raw;
}

function resolveAmbiguousOnza(otherUnit) {
  const vol = new Set(['litro', 'cc', 'onza_liquida']);
  const mass = new Set(['kg', 'gramo', 'onza_masa']);
  const o = otherUnit;
  if (vol.has(o)) return 'onza_liquida';
  if (mass.has(o)) return 'onza_masa';
  return 'onza_masa';
}

function normalizePositive(qty, field) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error(`${field} debe ser mayor que 0.`);
    err.status = 400;
    throw err;
  }
  return n;
}

/**
 * Convierte cantidad desde `fromUnit` hacia la unidad base del ítem `toUnit`.
 * Usado en mezclas (dosis por envase → kg / litro / unidad).
 */
function convertQtyToItemUnit(qty, fromUnit, toUnit) {
  let from = normalizeUnit(fromUnit, 'dose_unit');
  let to = normalizeUnit(toUnit, 'item_unit');
  const n = normalizePositive(qty, 'dosis');
  if (from === 'onza') from = resolveAmbiguousOnza(to);
  if (to === 'onza') to = resolveAmbiguousOnza(from);
  if (from === to) return round6(n);

  if (from === 'cc' && to === 'litro') return round6(n / 1000);
  if (from === 'litro' && to === 'cc') return round6(n * 1000);
  if (from === 'gramo' && to === 'kg') return round6(n / 1000);
  if (from === 'kg' && to === 'gramo') return round6(n * 1000);

  if (from === 'onza_liquida' && to === 'litro') return round6(n / FL_OZ_PER_LITER);
  if (from === 'litro' && to === 'onza_liquida') return round6(n * FL_OZ_PER_LITER);
  if (from === 'onza_liquida' && to === 'cc') return round6((n / FL_OZ_PER_LITER) * 1000);
  if (from === 'cc' && to === 'onza_liquida') return round6((n / 1000) * FL_OZ_PER_LITER);

  if (from === 'onza_masa' && to === 'kg') return round6(n / OZ_MASS_PER_KG);
  if (from === 'kg' && to === 'onza_masa') return round6(n * OZ_MASS_PER_KG);
  if (from === 'onza_masa' && to === 'gramo') return round6((n / OZ_MASS_PER_KG) * 1000);
  if (from === 'gramo' && to === 'onza_masa') return round6((n / 1000) * OZ_MASS_PER_KG);

  if (from === 'onza' && to === 'gramo') return round6(n * (1000 / OZ_MASS_PER_KG));
  if (from === 'gramo' && to === 'onza') return round6(n / (1000 / OZ_MASS_PER_KG));
  if (from === 'onza' && to === 'kg') return round6(n / OZ_MASS_PER_KG);
  if (from === 'kg' && to === 'onza') return round6(n * OZ_MASS_PER_KG);

  if (from === 'unidad' || to === 'unidad') {
    if (from === to) return round6(n);
    const err = new Error('Solo se puede mezclar "unidad" con la misma unidad del insumo.');
    err.status = 400;
    throw err;
  }

  const err = new Error(
    `No hay conversión de ${from} a ${to}. Indique la dosis en una unidad compatible con ${to}.`
  );
  err.status = 400;
  throw err;
}

module.exports = {
  convertQtyToItemUnit,
  normalizeUnit,
  round3,
};
