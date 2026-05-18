import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listAssetCategories, listAssets } from '../../services/assetsApi.js';

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function AssetsListPage() {
  const [categories, setCategories] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    /** 1 = activos, 0 = inactivos, '' = todos (evita `active=false` en la URL: Express 5 / qs lo malinterpreta). */
    active: '1',
    category_id: '',
    q: '',
  });
  const debouncedQ = useDebouncedValue(String(filters.q ?? '').trim(), 400);

  function buildListParams(f) {
    const p = {};
    const st = String(f?.active ?? '').trim();
    if (st === '1' || st === 'true' || st === true) p.active = '1';
    else if (st === '0' || st === 'false' || st === false) p.active = '0';
    const cid = String(f?.category_id ?? '').trim();
    if (cid) p.category_id = cid;
    const qt = String(f?.q ?? '').trim();
    if (qt) p.q = qt;
    return p;
  }

  async function load(f) {
    setLoading(true);
    setError('');
    try {
      const [cats, data] = await Promise.all([
        listAssetCategories(),
        listAssets(buildListParams(f)),
      ]);
      setCategories(Array.isArray(cats) ? cats : []);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({
      active: filters.active,
      category_id: filters.category_id,
      q: debouncedQ,
    });
  }, [filters.active, filters.category_id, debouncedQ]);

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Listado de activos</h3>
          <p className="text-sm text-slate-600">
            Bienes por categoría. La depreciación futura se detiene al inactivar el activo con causa contable (venta,
            donación o pérdida).
          </p>
        </div>
        <Link
          to="/admin/assets/new"
          className="inline-flex shrink-0 justify-center rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800"
        >
          Nuevo activo
        </Link>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-12 lg:items-end">
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Estado</span>
          <select
            value={filters.active}
            onChange={(e) => setFilters((f) => ({ ...f, active: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">Todos</option>
            <option value="1">Activos</option>
            <option value="0">Inactivos</option>
          </select>
        </label>
        <label className="text-sm lg:col-span-3">
          <span className="mb-1 block font-medium text-slate-800">Categoría</span>
          <select
            value={filters.category_id}
            onChange={(e) => setFilters((f) => ({ ...f, category_id: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm lg:col-span-7">
          <span className="mb-1 block font-medium text-slate-800">Buscar</span>
          <input
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Nombre, marca, placa…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Placa</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  Cargando activos…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No hay activos con estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-mono text-xs">{a.plate}</td>
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2 text-slate-600">{a.category_name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        a.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {a.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/admin/assets/${a.id}/ver`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        Ver
                      </Link>
                      <Link
                        to={`/admin/assets/${a.id}`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        Editar
                      </Link>
                      <Link
                        to={`/admin/assets/${a.id}/depreciacion`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                      >
                        Depreciación
                      </Link>
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
