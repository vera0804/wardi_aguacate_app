import { useState } from 'react';
import {
  MENU_ITEMS,
  canAccessEstadisticas,
  canAccessPlanilla,
  canManageExpenses,
  canManageFixedAssets,
} from './dashboardMenuData.js';
import DashboardMenuIcon from './DashboardMenuIcon.jsx';
import { getUserDisplayName } from '../utils/userDisplayName.js';
import { isTenantAdmin } from './dashboardMenuData.js';
import { licenseExpiryDisplayForUser } from '../utils/licenseExpiryDisplay.js';
import OfflineStatusBar from '../components/OfflineStatusBar.jsx';

/**
 * Marco visual compartido con el panel principal: barra lateral, encabezado Wardi y pie de sesión.
 */
export default function DashboardShell({
  user,
  highlightedMenu,
  onMenuItemClick,
  onLogout,
  banner = null,
  mainClassName = 'min-h-[calc(100vh-53px)] bg-slate-100 p-6',
  mainStyle,
  children,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const displayName = getUserDisplayName(user);
  const licenseExpiryLabel = licenseExpiryDisplayForUser(user);

  function handleMenuClick(item) {
    onMenuItemClick(item.label);
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-100">
      <div className="grid min-h-screen w-full grid-cols-1">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
          />
        ) : null}

        <aside
          className={`fixed inset-y-0 left-0 z-40 bg-lime-800 py-5 shadow-xl transition-transform duration-200 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${sidebarCollapsed ? 'w-[84px] px-2' : 'w-[250px] px-4'}`}
        >
          <div className="mb-4 rounded-lg bg-lime-700/90 px-3 py-2 text-center text-sm font-semibold">
            {sidebarCollapsed ? 'ADM' : 'Administración'}
          </div>

          <nav aria-label="Menú principal">
            <ul className="space-y-1">
              {MENU_ITEMS.filter((item) => {
                if (item.label === 'Activos') return canManageFixedAssets(user);
                if (item.label === 'Gastos') return canManageExpenses(user);
                if (item.label === 'Estadísticas') return canAccessEstadisticas(user);
                if (item.label === 'Planilla') return canAccessPlanilla(user);
                return true;
              }).map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() => handleMenuClick(item)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                      highlightedMenu === item.label
                        ? 'bg-lime-600 font-semibold text-white'
                        : 'text-lime-50 hover:bg-lime-700/90'
                    }`}
                  >
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/15">
                      <DashboardMenuIcon name={item.icon} />
                    </span>
                    {!sidebarCollapsed ? <span>{item.label}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main
          className={`relative min-h-screen overflow-hidden transition-all ${sidebarCollapsed ? 'lg:ml-[84px]' : 'lg:ml-[250px]'}`}
        >
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 text-sm text-slate-700">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Abrir menú"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex items-center justify-center rounded border border-slate-300 px-2 py-1 text-slate-700 lg:hidden"
              >
                ☰
              </button>
              <button
                type="button"
                aria-label="Contraer menú"
                onClick={() => setSidebarCollapsed((v) => !v)}
                className="hidden items-center justify-center rounded border border-slate-300 px-2 py-1 text-slate-700 lg:inline-flex"
              >
                {sidebarCollapsed ? '»' : '«'}
              </button>
              <div className="font-semibold text-lime-700">Wardi Aguacate</div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-600">{displayName}</span>
              <button type="button" className="text-lime-700 hover:underline">
                Cambiar contraseña
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="font-medium text-lime-800 hover:underline"
              >
                Salir
              </button>
            </div>
          </div>

          {banner}
          <OfflineStatusBar />

          <div className={mainClassName} style={mainStyle}>
            {children}

            <div className="mt-6 rounded-xl border border-white/50 bg-white/75 px-4 py-3 text-sm text-slate-700 shadow">
              Sesión activa como <span className="font-semibold">{displayName}</span>
              {user?.role ? (
                <>
                  {' '}
                  · rol <span className="font-semibold">{user.role}</span>
                </>
              ) : null}
              {user?.clientName ? (
                <>
                  {' '}
                  · <span className="font-semibold">{user.clientName}</span>
                </>
              ) : null}
              {isTenantAdmin(user) && licenseExpiryLabel ? (
                <>
                  <br />
                  <span className="text-slate-600">
                    Vencimiento de la licencia:{' '}
                    <span className="font-semibold text-slate-800">{licenseExpiryLabel}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
