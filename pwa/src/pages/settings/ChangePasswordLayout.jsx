import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import DashboardShell from '../../layouts/DashboardShell.jsx';
import { DASHBOARD_MENU_STORAGE_KEY } from '../../layouts/dashboardMenuData.js';

export default function ChangePasswordLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

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
      highlightedMenu="Configuración"
      onMenuItemClick={onMenuItemClick}
      onLogout={handleLogout}
      mainClassName="min-h-[calc(100vh-53px)] bg-slate-100 p-6"
    >
      <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
        <Outlet />
      </section>
    </DashboardShell>
  );
}
