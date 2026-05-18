import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { canManageExpenses, isTenantAdmin } from './layouts/dashboardMenuData.js';
import OnlineOnlyRoute from './components/OnlineOnlyRoute.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const SuperadminClientsPage = lazy(() => import('./pages/SuperadminClientsPage.jsx'));
const AssetAdminRoutes = lazy(() => import('./pages/assets/AssetAdminRoutes.jsx'));
const AssetCategoriesRoutes = lazy(() => import('./pages/settings/AssetCategoriesRoutes.jsx'));
const ExpenseCategoriesRoutes = lazy(() => import('./pages/settings/ExpenseCategoriesRoutes.jsx'));
const ExpensesRoutes = lazy(() => import('./pages/expenses/ExpensesRoutes.jsx'));
const UsersSettingsRoutes = lazy(() => import('./pages/settings/UsersSettingsRoutes.jsx'));
const ChangePasswordSettingsRoutes = lazy(() => import('./pages/settings/ChangePasswordSettingsRoutes.jsx'));
const StatsRoutes = lazy(() => import('./pages/stats/StatsRoutes.jsx'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-green-950/5 text-green-900">
      <p className="text-sm">Cargando…</p>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) {
    return <RouteFallback />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.isSuperadmin && user.needsTenantSelection) {
    const p = location.pathname;
    if (!p.startsWith('/superadmin') && !p.startsWith('/settings/change-password')) {
      return <Navigate to="/superadmin/clients" replace />;
    }
  }
  return children;
}

function GastosModuleRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <RouteFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (!canManageExpenses(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function AdminOnlyRoute({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <RouteFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isTenantAdmin(user)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/olvidaste-contrasena" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route
          path="/superadmin/clients"
          element={
            <ProtectedRoute>
              <OnlineOnlyRoute>
                <Suspense fallback={<RouteFallback />}>
                  <SuperadminClientsPage />
                </Suspense>
              </OnlineOnlyRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/assets/*"
          element={
            <ProtectedRoute>
              <AdminOnlyRoute>
                <Suspense fallback={<RouteFallback />}>
                  <AssetAdminRoutes />
                </Suspense>
              </AdminOnlyRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/asset-categories/*"
          element={
            <ProtectedRoute>
              <GastosModuleRoute>
                <OnlineOnlyRoute>
                  <Suspense fallback={<RouteFallback />}>
                    <AssetCategoriesRoutes />
                  </Suspense>
                </OnlineOnlyRoute>
              </GastosModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/users/*"
          element={
            <ProtectedRoute>
              <AdminOnlyRoute>
                <OnlineOnlyRoute>
                  <Suspense fallback={<RouteFallback />}>
                    <UsersSettingsRoutes />
                  </Suspense>
                </OnlineOnlyRoute>
              </AdminOnlyRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/expense-categories/*"
          element={
            <ProtectedRoute>
              <GastosModuleRoute>
                <OnlineOnlyRoute>
                  <Suspense fallback={<RouteFallback />}>
                    <ExpenseCategoriesRoutes />
                  </Suspense>
                </OnlineOnlyRoute>
              </GastosModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/change-password"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <ChangePasswordSettingsRoutes />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/expenses/*"
          element={
            <ProtectedRoute>
              <GastosModuleRoute>
                <Suspense fallback={<RouteFallback />}>
                  <ExpensesRoutes />
                </Suspense>
              </GastosModuleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/stats/*"
          element={
            <ProtectedRoute>
              <AdminOnlyRoute>
                <Suspense fallback={<RouteFallback />}>
                  <StatsRoutes />
                </Suspense>
              </AdminOnlyRoute>
            </ProtectedRoute>
          }
        />
        <Route path="/admin/terminos" element={<Placeholder title="Términos del administrador" />} />
        <Route path="/admin/*" element={<Placeholder title="Panel administración" />} />
        <Route path="/piloto/*" element={<Placeholder title="Panel piloto" />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}

function Placeholder({ title }) {
  return (
    <div className="min-h-screen bg-amber-50 p-6 text-green-950">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-green-900/80">Ruta provisional hasta conectar layouts reales.</p>
    </div>
  );
}
