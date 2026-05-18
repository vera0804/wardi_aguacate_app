import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import DashboardShell from '../../layouts/DashboardShell.jsx';
import { DASHBOARD_MENU_STORAGE_KEY } from '../../layouts/dashboardMenuData.js';
import OfflineUnavailable from '../../components/OfflineUnavailable.jsx';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';

export default function StatsLayout() {
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
    if (label === 'Estadísticas') {
      navigate('/stats');
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
      highlightedMenu="Estadísticas"
      onMenuItemClick={onMenuItemClick}
      onLogout={handleLogout}
      mainClassName="min-h-[calc(100vh-53px)] bg-stone-50 p-6"
    >
      {!online ? <OfflineUnavailable /> : <Outlet />}
    </DashboardShell>
  );
}
