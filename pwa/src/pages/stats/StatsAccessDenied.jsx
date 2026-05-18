import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';

export default function StatsAccessDenied() {
  const { user } = useAuth();
  const needTenant = user?.isSuperadmin && user?.needsTenantSelection;

  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50/80 p-5 text-sm text-amber-950">
      <p className="font-medium">Acceso restringido</p>
      <p className="mt-1 text-amber-900/90">
        {needTenant ? (
          <>
            Como superadministrador debe{' '}
            <Link to="/superadmin/clients" className="font-medium text-lime-900 underline hover:text-lime-950">
              elegir una organización
            </Link>{' '}
            para ver las estadísticas de ese cliente.
          </>
        ) : (
          <>Tu rol no tiene permiso para ver estadísticas operativas.</>
        )}
      </p>
      <Link to="/stats" className="mt-3 inline-block text-lime-800 hover:underline">
        ← Volver al índice
      </Link>
    </div>
  );
}
