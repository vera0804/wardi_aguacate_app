import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listFarms } from '../../services/farms.js';
import { listGeneralExpenses, createGeneralExpense, setGeneralExpenseActive } from '../../services/expensesApi.js';
import { usePendingSyncIds } from '../../hooks/usePendingSyncIds.js';
import { enqueuePendingJob, listPendingJobs, removePendingJob } from '../../offline/expensesSyncStore.js';

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export default function GeneralExpensesPage({ embedded = false, refreshKey = 0 }) {
  const [farms, setFarms] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    farm_id: '',
    category: '',
    active: 'true',
    from: '',
    to: '',
  });
  const debouncedCategory = useDebouncedValue(filters.category.trim(), 350);

  const flushQueue = async () => {
    const jobs = await listPendingJobs('general_expenses');
    for (const job of jobs) {
      const p = job.payload;
      try {
        if (p.kind === 'create') await createGeneralExpense(p.body);
        else if (p.kind === 'active') await setGeneralExpenseActive(p.id, p.is_active);
        await removePendingJob('general_expenses', job.id);
      } catch {
        /* keep */
      }
    }
  };

  const { pendingCount, refresh: refreshPending } = usePendingSyncIds('general_expenses', { flush: flushQueue });

  useEffect(() => {
    (async () => {
      try {
        const fRes = await listFarms();
        setFarms(Array.isArray(fRes) ? fRes : []);
      } catch {
        setFarms([]);
      }
    })();
  }, []);

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const params = {
        limit: pageSize,
        offset: page * pageSize,
        farm_id: filters.farm_id || undefined,
        category: debouncedCategory || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      };
      const st = String(filters.active ?? '').trim();
      if (st === '1' || st === 'true') params.active = 'true';
      else if (st === '0' || st === 'false') params.active = 'false';
      const data = await listGeneralExpenses(params);
      setRows(data?.rows || []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      setError(e?.message || 'No se pudo cargar.');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList();
  }, [page, filters.farm_id, filters.active, filters.from, filters.to, debouncedCategory, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function toggleActive(row) {
    try {
      await setGeneralExpenseActive(row.id, !row.is_active);
      await loadList();
    } catch (err) {
      if (!navigator.onLine || String(err?.message || '').toLowerCase().includes('failed to fetch')) {
        await enqueuePendingJob('general_expenses', { kind: 'active', id: row.id, is_active: !row.is_active });
        await refreshPending();
        setError('Cambio de estado en cola (sin conexión).');
      } else setError(err?.message || 'No se pudo actualizar.');
    }
  }

  return (
    <div className="space-y-4">
      {pendingCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Hay {pendingCount} operación(es) pendiente(s) de gastos generales.</span>
          <button
            type="button"
            onClick={() => flushQueue().then(() => refreshPending()).then(() => loadList())}
            className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
          >
            Reintentar ahora
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}

      {embedded ? (
        <p className="text-xs text-slate-600">
          Reparto entre lotes según alcance (finca o empresa) y método. Manual: ajuste en Detalle. Alta nuevo: pestaña{' '}
          <strong>Registrar gasto general</strong>.
        </p>
      ) : (
        <div className="rounded-lg border border-lime-200 bg-lime-50/80 px-3 py-3 text-sm text-slate-800">
          <p className="font-semibold text-lime-900">Cómo se asigna un gasto general</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-700">
            <li>
              <strong>Alcance:</strong> si deja <strong>finca vacía</strong>, el monto se reparte entre{' '}
              <strong>todos los lotes activos con hectáreas</strong> de su empresa. Si elige una <strong>finca</strong>, solo entran los lotes activos con área de esa finca.
            </li>
            <li>
              <strong>Por hectáreas:</strong> el servidor reparte el total en proporción al área (ha) de cada lote dentro del alcance; no hace falta guardar reparto manual.
            </li>
            <li>
              <strong>Manual:</strong> en Detalle puede generar una línea por lote (mismo alcance) y luego ajustar % o montos hasta que la suma coincida con el total.
            </li>
          </ul>
          <p className="mt-2 text-xs text-slate-600">
            Esto es distinto de <strong>Por lote</strong>, donde elige un solo lote y el monto va entero a ese lote. Para registrar un gasto nuevo use <strong>Nuevo gasto</strong> en la barra superior.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-12 lg:items-end">
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Finca</span>
          <select
            value={filters.farm_id}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, farm_id: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">Todas las fincas (todos los lotes)</option>
            {farms.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Estado</span>
          <select
            value={filters.active}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, active: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Desde</span>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, from: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Hasta</span>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, to: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Categoría</span>
          <input
            value={filters.category}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, category: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="max-h-[min(55vh,32rem)] overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 shadow-sm">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-left">Finca</th>
              <th className="px-3 py-2 text-left">Método</th>
              <th className="px-3 py-2 text-right">CRC</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Sin registros.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">{String(r.exp_date || '').slice(0, 10)}</td>
                  <td className="px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2">{r.farm_id ? r.farm_name || '—' : 'Todas las fincas'}</td>
                  <td className="px-3 py-2 text-xs uppercase">{r.allocation_method}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {Number(r.amount_crc || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' })}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {r.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={`/expenses/general/${r.id}`}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Detalle
                      </Link>
                      <button
                        type="button"
                        onClick={() => toggleActive(r)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        {r.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          Página {page + 1} de {totalPages} · {total} registros
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>
    </div>
  );
}
