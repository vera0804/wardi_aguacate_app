export const DASHBOARD_MENU_STORAGE_KEY = 'wardi.dashboard.menu';

export const MENU_ITEMS = [
  { label: 'Inicio', icon: 'home' },
  { label: 'Fincas', icon: 'farm' },
  { label: 'Lotes', icon: 'lot' },
  { label: 'Inventario', icon: 'inventory' },
  { label: 'Aplicaciones', icon: 'spray' },
  { label: 'Producción de aguacate', icon: 'production' },
  { label: 'Trabajadores', icon: 'workers' },
  { label: 'Registro de labores', icon: 'tasks' },
  { label: 'Cronograma', icon: 'calendar' },
  { label: 'Activos', icon: 'assets' },
  { label: 'Gastos', icon: 'expenses' },
  { label: 'Planilla', icon: 'payroll' },
  { label: 'Estadísticas', icon: 'stats' },
  { label: 'Configuración', icon: 'settings' },
];

export const CONFIG_GROUPS = [
  {
    title: 'Seguridad y acceso',
    items: [
      { label: 'Gestión de usuarios', icon: 'workers' },
      { label: 'Cambiar contraseña', icon: 'password' },
    ],
  },
  {
    title: 'Catálogos operativos',
    items: [
      { label: 'Categorías de activos', icon: 'assets' },
      { label: 'Categorías de gastos', icon: 'expenses' },
      { label: 'Marcas de fabricantes', icon: 'factory' },
      { label: 'Definir calibres del aguacate', icon: 'avocado' },
    ],
  },
];

export function isSuperadmin(user) {
  return String(user?.role || '').trim().toLowerCase() === 'superadmin';
}

export function isTenantAdmin(user) {
  const r = String(user?.role || '').trim().toLowerCase();
  if (r === 'superadmin' && user?.actingClientId) return true;
  return r === 'admin';
}

export function isOperario(user) {
  if (isSuperadmin(user)) return false;
  return String(user?.role || '').trim().toLowerCase() === 'operario';
}

/** Módulo Gastos: admin y operario. */
export function canManageExpenses(user) {
  const r = String(user?.role || '').trim().toLowerCase();
  if (r === 'superadmin' && user?.actingClientId) return true;
  return r === 'admin' || r === 'operario';
}

/** Activos fijos / depreciación (/admin/assets): solo administrador. */
export function canManageFixedAssets(user) {
  return isTenantAdmin(user);
}

/** Estadísticas globales: solo administrador. */
export function canAccessEstadisticas(user) {
  return isTenantAdmin(user);
}

/** Planilla y aguinaldos: solo administrador. */
export function canAccessPlanilla(user) {
  return isTenantAdmin(user);
}

/** Catálogos operativos en Configuración (categorías, marcas, calibres). */
export function canManageOperationalCatalogs(user) {
  return canManageExpenses(user);
}
