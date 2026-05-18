import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import DashboardShell from '../../layouts/DashboardShell.jsx';
import { DASHBOARD_MENU_STORAGE_KEY } from '../../layouts/dashboardMenuData.js';
import BccrUsdReference from '../../shared/BccrUsdReference.jsx';
import OfflineUnavailable from '../../components/OfflineUnavailable.jsx';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

export default function AssetsLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  function onMenuItemClick(label) {
    if (label === 'Activos') {
      navigate('/admin/assets');
      return;
    }
    if (label === 'Gastos') {
      navigate('/expenses/historial');
      return;
    }
    try {
      sessionStorage.setItem(DASHBOARD_MENU_STORAGE_KEY, label);
    } catch {
      /* ignore */
    }
    navigate('/dashboard');
  }

  return (
    <DashboardShell
      user={user}
      highlightedMenu="Activos"
      onMenuItemClick={onMenuItemClick}
      onLogout={handleLogout}
      mainClassName="min-h-[calc(100vh-53px)] bg-slate-100 p-6"
    >
      {!online ? (
        <OfflineUnavailable />
      ) : (
        <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
          <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-lime-800">Activos</h2>
              <p className="mt-1 text-sm text-slate-600">
                Bienes por categoría, valores en libros y depreciación. El tipo de cambio mostrado es solo referencia
                del BCCR.
              </p>
            </div>
            <BccrUsdReference className="shrink-0 sm:mt-0.5" />
          </header>
          <Outlet />
        </section>
      )}
    </DashboardShell>
  );
}
