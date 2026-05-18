import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAssetCategory } from '../../services/assetsApi.js';

export default function AssetCategoryViewPage() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setRow(await getAssetCategory(id));
      } catch (e) {
        setError(e?.message || 'No encontrada.');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <section className="space-y-4">
        <Link to="/settings/asset-categories" className="text-sm text-lime-800 hover:underline">
          ← Listado
        </Link>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      </section>
    );
  }
  if (!row) return <p className="text-sm text-slate-600">Cargando…</p>;

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link to="/settings/asset-categories" className="text-sm text-lime-800 hover:underline">
            ← Listado
          </Link>
          <h3 className="text-base font-semibold text-lime-800">{row.name}</h3>
        </div>
        <Link
          to={`/settings/asset-categories/${id}`}
          className="inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Editar
        </Link>
      </header>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <p className="font-medium text-slate-600">Estado</p>
        <p className="mt-1">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
              row.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {row.is_active ? 'Activa' : 'Inactiva'}
          </span>
        </p>
      </div>
    </section>
  );
}
