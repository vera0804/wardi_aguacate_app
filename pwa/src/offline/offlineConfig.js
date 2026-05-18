/** Módulos del menú principal que deben operar sin conexión. */
export const OFFLINE_MENU_LABELS = new Set([
  'Inventario',
  'Aplicaciones',
  'Producción de aguacate',
  'Trabajadores',
  'Registro de labores',
  'Gastos',
]);

export const OFFLINE_UNAVAILABLE_MESSAGE =
  'Usted está offline, esta funcionalidad estará disponible cuando vuelva a conectarse a una red';

/** Prefijos GET que el service worker puede cachear (lecturas offline). */
export const OFFLINE_API_GET_PREFIXES = [
  '/api/exchange-rate',
  '/api/farms',
  '/api/lots',
  '/api/geo',
  '/api/workers',
  '/api/labor-entries',
  '/api/calibers',
  '/api/avocado-production',
  '/api/inventory-items',
  '/api/inventory-brands',
  '/api/inventory-movements',
  '/api/inventory-consumptions',
  '/api/mix-applications',
  '/api/expenses',
  '/api/general-expenses',
  '/api/general-expense-allocations',
  '/api/expense-categories',
];

/**
 * Mutaciones en cola genérica (gastos usan expensesSyncStore aparte).
 */
export const OFFLINE_API_MUTATION_PREFIXES = [
  '/api/farms',
  '/api/lots',
  '/api/workers',
  '/api/labor-entries',
  '/api/calibers',
  '/api/avocado-production',
  '/api/inventory-items',
  '/api/inventory-brands',
  '/api/inventory-movements',
  '/api/inventory-consumptions',
  '/api/mix-applications',
];

export const OFFLINE_MUTATION_EXCLUDED_PREFIXES = [
  '/api/expenses',
  '/api/general-expenses',
  '/api/general-expense-allocations',
];

export function isOfflineMenuLabel(label) {
  return OFFLINE_MENU_LABELS.has(String(label || '').trim());
}

export function isOfflineSupportedGet(path) {
  const p = String(path || '');
  return OFFLINE_API_GET_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export function isOfflineSupportedMutation(path, method) {
  const m = String(method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return false;
  const p = String(path || '');
  if (OFFLINE_MUTATION_EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    return false;
  }
  return OFFLINE_API_MUTATION_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export function matchOfflineApiPathname(pathname) {
  return OFFLINE_API_GET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
