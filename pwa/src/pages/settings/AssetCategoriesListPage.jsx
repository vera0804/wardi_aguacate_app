import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAssetCategories, setAssetCategoryActive } from '../../services/assetsApi.js';

export default function AssetCategoriesListPage() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  async function load() {
    setError('');
    try {
      const params = activeFilter ? { active: activeFilter } : {};
      const data = await listAssetCategories(params);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Error al cargar.');
    }
  }

  useEffect(() => {
    load();
  }, [activeFilter]);

  async function toggle(row, next) {
    try {
      await setAssetCategoryActive(row.id, next);
      await load();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar.');
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Listado de categorías</h3>
          <p className="text-sm text-slate-600">Filtra y edita; cada categoría pertenece a tu organización.</p>
        </div>
        <Link
          to="/settings/asset-categories/new"
          className="inline-flex shrink-0 justify-center rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800"
        >
          Nueva categoría
        </Link>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Filtrar</span>
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 sm:w-auto"
          >
            <option value="">Todas</option>
            <option value="true">Activas</option>
            <option value="false">Inactivas</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                  No hay categorías.
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{c.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        c.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {c.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/settings/asset-categories/${c.id}/ver`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        Ver
                      </Link>
                      <Link
                        to={`/settings/asset-categories/${c.id}`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        Editar
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggle(c, !c.is_active)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        {c.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
