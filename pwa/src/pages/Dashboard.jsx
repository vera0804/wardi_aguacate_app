import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { superadminLeaveTenant } from '../services/superadminApi.js';
import DashboardShell from '../layouts/DashboardShell.jsx';
import { getUserDisplayName } from '../utils/userDisplayName.js';
import DashboardMenuIcon from '../layouts/DashboardMenuIcon.jsx';
import {
  CONFIG_GROUPS,
  DASHBOARD_MENU_STORAGE_KEY,
  MENU_ITEMS,
  canAccessEstadisticas,
  canAccessPlanilla,
  canManageExpenses,
  canManageFixedAssets,
  canManageOperationalCatalogs,
  isTenantAdmin,
  isSuperadmin,
} from '../layouts/dashboardMenuData.js';
import FarmsPage from './FarmsPage.jsx';
import LotsPage from './LotsPage.jsx';
import WorkersPage from './WorkersPage.jsx';
import LaborEntriesPage from './LaborEntriesPage.jsx';
import CalibersSettingsSection from './CalibersSettingsSection.jsx';
import AvocadoProductionPage from './AvocadoProductionPage.jsx';
import InventoryPage from './InventoryPage.jsx';
import InventoryBrandsSettingsSection from './InventoryBrandsSettingsSection.jsx';
import ApplicationsPage from './ApplicationsPage.jsx';
import Cronograma from './Cronograma.jsx';
import PayrollSection from './payroll/PayrollSection.jsx';
import OfflineModuleGate from '../components/OfflineModuleGate.jsx';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { isOfflineMenuLabel, OFFLINE_UNAVAILABLE_MESSAGE } from '../offline/offlineConfig.js';

/** Fondo de Inicio: logotransparente centrado, ligeramente bajo para dejar aire al saludo. */
const INICIO_MAIN_STYLE = {
  backgroundColor: '#f1f5f9',
  backgroundImage: "url('/images/logosinnombretransparente.png')",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'center 62%',
  backgroundSize: 'auto min(54vmin, 580px)',
};

export default function Dashboard() {
  const { user, setUser, signOut } = useAuth();
  const navigate = useNavigate();
  const [activeMenu, setActiveMenu] = useState('Inicio');
  const [activeSettingItem, setActiveSettingItem] = useState('');

  useEffect(() => {
    try {
      const m = sessionStorage.getItem(DASHBOARD_MENU_STORAGE_KEY);
      if (m && MENU_ITEMS.some((i) => i.label === m)) {
        setActiveMenu(m);
      }
      if (m) sessionStorage.removeItem(DASHBOARD_MENU_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  async function handleLeaveTenantView() {
    try {
      const profile = await superadminLeaveTenant();
      setUser(profile);
      navigate('/superadmin/clients', { replace: true });
    } catch {
      navigate('/superadmin/clients', { replace: true });
    }
  }

  const superadminBanner =
    isSuperadmin(user) && user?.actingClientId ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm text-amber-950">
        <span>
          Plataforma: viendo la organización{' '}
          <strong>{user.clientName || user.clientId}</strong>
        </span>
        <button
          type="button"
          className="font-medium text-amber-900 underline"
          onClick={handleLeaveTenantView}
        >
          Cambiar organización
        </button>
      </div>
    ) : null;

  const mainClassName = `min-h-[calc(100vh-53px)] p-6 ${activeMenu === 'Inicio' ? 'bg-slate-100' : 'bg-slate-100'}`;
  const mainStyle = activeMenu === 'Inicio' ? INICIO_MAIN_STYLE : undefined;

  function handleMenuSelection(label) {
    if (label === 'Activos') {
      navigate('/admin/assets');
      return;
    }
    if (label === 'Gastos') {
      navigate('/expenses/historial');
      return;
    }
    if (label === 'Estadísticas') {
      navigate('/stats');
      return;
    }
    setActiveMenu(label);
    if (label !== 'Configuración') setActiveSettingItem('');
  }

  return (
    <DashboardShell
      user={user}
      banner={superadminBanner}
      highlightedMenu={activeMenu}
      onMenuItemClick={handleMenuSelection}
      onLogout={handleLogout}
      mainClassName={mainClassName}
      mainStyle={mainStyle}
    >
            {activeMenu === 'Fincas' ? (
              <OfflineModuleGate menuLabel="Fincas">
                <FarmsPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Lotes' ? (
              <OfflineModuleGate menuLabel="Lotes">
                <LotsPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Trabajadores' ? (
              <OfflineModuleGate menuLabel="Trabajadores">
                <WorkersPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Inventario' ? (
              <OfflineModuleGate menuLabel="Inventario">
                <InventoryPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Aplicaciones' ? (
              <OfflineModuleGate menuLabel="Aplicaciones">
                <ApplicationsPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Producción de aguacate' ? (
              <OfflineModuleGate menuLabel="Producción de aguacate">
                <AvocadoProductionPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Registro de labores' ? (
              <OfflineModuleGate menuLabel="Registro de labores">
                <LaborEntriesPage user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Planilla' ? (
              <OfflineModuleGate menuLabel="Planilla">
                <PayrollSection user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Cronograma' ? (
              <OfflineModuleGate menuLabel="Cronograma">
                <Cronograma user={user} />
              </OfflineModuleGate>
            ) : activeMenu === 'Configuración' ? (
              <OfflineModuleGate menuLabel="Configuración">
              <>
                {activeSettingItem === 'Definir calibres del aguacate' ? (
                  <>
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => setActiveSettingItem('')}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        ← Volver a Configuración
                      </button>
                    </div>
                    <CalibersSettingsSection user={user} />
                  </>
                ) : activeSettingItem === 'Marcas de fabricantes' ? (
                  <>
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={() => setActiveSettingItem('')}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        ← Volver a Configuración
                      </button>
                    </div>
                    <InventoryBrandsSettingsSection user={user} />
                  </>
                ) : (
                  <section className="rounded-2xl border border-white/50 bg-white/85 p-5 text-slate-800 shadow">
                    <h3 className="text-base font-semibold text-lime-800">Configuración del sistema</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Catálogos y parámetros administrativos que deben configurarse en este módulo.
                    </p>

                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {CONFIG_GROUPS.map((group) => (
                        <section
                          key={group.title}
                          className="rounded-xl border border-slate-200 bg-slate-50/90 p-3"
                        >
                          <h4 className="mb-2 text-sm font-semibold text-slate-800">{group.title}</h4>
                          <div className="grid grid-cols-1 gap-2">
                            {group.items
                              .filter((item) => {
                                if (item.label === 'Categorías de activos') return canManageOperationalCatalogs(user);
                                if (item.label === 'Categorías de gastos') return canManageOperationalCatalogs(user);
                                if (item.label === 'Gestión de usuarios') return isTenantAdmin(user);
                                return true;
                              })
                              .map((item) => {
                              const isCalibersItem = item.label === 'Definir calibres del aguacate';
                              const isBrandsItem = item.label === 'Marcas de fabricantes';
                              const isAssetCats = item.label === 'Categorías de activos';
                              const isExpenseCats = item.label === 'Categorías de gastos';
                              const isUsersMgmt = item.label === 'Gestión de usuarios';
                              const isChangePassword = item.label === 'Cambiar contraseña';
                              return (
                                <button
                                  key={item.label}
                                  type="button"
                                  onClick={() => {
                                    if (isAssetCats) {
                                      navigate('/settings/asset-categories');
                                      return;
                                    }
                                    if (isExpenseCats) {
                                      navigate('/settings/expense-categories');
                                      return;
                                    }
                                    if (isUsersMgmt) {
                                      navigate('/settings/users');
                                      return;
                                    }
                                    if (isChangePassword) {
                                      navigate('/settings/change-password');
                                      return;
                                    }
                                    if (isCalibersItem || isBrandsItem) setActiveSettingItem(item.label);
                                  }}
                                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-lime-300 hover:bg-lime-50/50"
                                >
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-lime-100 text-lime-700">
                                    <DashboardMenuIcon name={item.icon} />
                                  </span>
                                  <span>{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>
                )}
              </>
              </OfflineModuleGate>
            ) : (
              <HomeLanding
                user={user}
                userName={getUserDisplayName(user) || 'Usuario'}
                onSelectMenu={handleMenuSelection}
              />
            )}
    </DashboardShell>
  );
}

/** Visibilidad del menú lateral (misma lógica que DashboardShell). */
function homeMenuCardsForUser(user) {
  return MENU_ITEMS.filter((item) => {
    if (item.label === 'Inicio' || item.label === 'Configuración') return false;
    if (item.label === 'Activos') return canManageFixedAssets(user);
    if (item.label === 'Gastos') return canManageExpenses(user);
    if (item.label === 'Estadísticas') return canAccessEstadisticas(user);
    if (item.label === 'Planilla') return canAccessPlanilla(user);
    return true;
  });
}

const HOME_CARD_DESCRIPTION = {
  Fincas: 'Administra fincas y ubicaciones.',
  Lotes: 'Gestiona lotes por finca.',
  Inventario: 'Stock, insumos y movimientos.',
  Aplicaciones: 'Registro y seguimiento de aplicaciones.',
  'Producción de aguacate': 'Cosechas, calibres y producción.',
  Trabajadores: 'Directorio y datos del personal.',
  'Registro de labores': 'Labores diarias en campo.',
  Cronograma: 'Planificación de actividades.',
  Activos: 'Activos fijos y depreciación.',
  Gastos: 'Gastos generales y por lote.',
  Planilla: 'Nómina y pagos al personal.',
  Estadísticas: 'Indicadores y reportes operativos.',
};

const HOME_CARD_TONE_CYCLE = ['teal', 'sky', 'green', 'rose', 'indigo', 'violet', 'amber', 'slate'];

function HomeLanding({ user, userName, onSelectMenu }) {
  const online = useOnlineStatus();
  const [offlineHint, setOfflineHint] = useState('');

  function trySelectMenu(label) {
    if (!online && !isOfflineMenuLabel(label)) {
      setOfflineHint(OFFLINE_UNAVAILABLE_MESSAGE);
      return;
    }
    setOfflineHint('');
    onSelectMenu(label);
  }

  const items = homeMenuCardsForUser(user);
  const mid = Math.ceil(items.length / 2);
  const left = items.slice(0, mid);
  const right = items.slice(mid);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-8 lg:flex-row lg:items-start lg:justify-center lg:gap-6 xl:gap-10">
      <aside className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:mt-8 lg:w-[min(100%,260px)] lg:flex-shrink-0 xl:w-[280px]">
        {left.map((item, i) => (
          <MenuActionCard
            key={item.label}
            label={item.label}
            icon={item.icon}
            text={HOME_CARD_DESCRIPTION[item.label] || 'Abrir este módulo.'}
            tone={HOME_CARD_TONE_CYCLE[i % HOME_CARD_TONE_CYCLE.length]}
            onClick={() => trySelectMenu(item.label)}
          />
        ))}
      </aside>

      <section className="relative z-10 order-1 -mt-4 flex w-full flex-col items-center justify-center text-center sm:-mt-5 lg:order-2 lg:-mt-7 lg:w-[min(100%,420px)] lg:flex-shrink-0 lg:min-h-[280px]">
        <div className="rounded-2xl border border-slate-200/90 bg-white px-6 py-8 shadow-md sm:px-8">
          <p className="text-2xl font-semibold leading-snug text-slate-800 sm:text-3xl">
            Bienvenido(a), <span className="text-lime-700">{userName}</span>
          </p>
          <p className="mt-2 text-base text-slate-600 sm:text-lg">¿Qué deseas hacer hoy?</p>
          {offlineHint ? (
            <p className="mt-3 text-sm text-amber-800">{offlineHint}</p>
          ) : null}
        </div>
      </section>

      <aside className="order-3 flex w-full flex-col gap-3 lg:mt-8 lg:w-[min(100%,260px)] lg:flex-shrink-0 xl:w-[280px]">
        {right.map((item, i) => (
          <MenuActionCard
            key={item.label}
            label={item.label}
            icon={item.icon}
            text={HOME_CARD_DESCRIPTION[item.label] || 'Abrir este módulo.'}
            tone={HOME_CARD_TONE_CYCLE[(i + mid) % HOME_CARD_TONE_CYCLE.length]}
            onClick={() => trySelectMenu(item.label)}
          />
        ))}
      </aside>
    </div>
  );
}

function MenuActionCard({ label, icon, text, tone, onClick }) {
  const toneClass = {
    teal: 'border-teal-200/80 bg-teal-50/95',
    sky: 'border-sky-200/80 bg-sky-50/95',
    green: 'border-green-200/80 bg-green-50/95',
    rose: 'border-rose-200/80 bg-rose-50/95',
    indigo: 'border-indigo-200/80 bg-indigo-50/95',
    violet: 'border-violet-200/80 bg-violet-50/95',
    amber: 'border-amber-200/80 bg-amber-50/95',
    slate: 'border-slate-200/80 bg-slate-50/95',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left text-slate-800 shadow transition hover:brightness-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-600 ${toneClass[tone] || toneClass.slate}`}
    >
      <span className="flex items-start gap-2">
        <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/80 text-lime-800 shadow-sm">
          <DashboardMenuIcon name={icon} />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="mt-1 block text-xs text-slate-600">{text}</span>
        </span>
      </span>
    </button>
  );
}
