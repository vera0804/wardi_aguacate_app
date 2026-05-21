import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getExpensesMeta,
  listExpenses,
  createExpense,
  updateExpense,
  setExpenseActive,
  getExpense,
} from '../../services/expensesApi.js';
import { usePendingSyncIds } from '../../hooks/usePendingSyncIds.js';
import { enqueuePendingJob, listPendingJobs, removePendingJob } from '../../offline/expensesSyncStore.js';
import ExpenseCategoryCombo from './ExpenseCategoryCombo.jsx';
import FxRateUsdField from '../../shared/FxRateUsdField.jsx';

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

const emptyForm = {
  lot_id: '',
  exp_date: '',
  category_id: '',
  description: '',
  currency: 'CRC',
  amount_input: '',
  fx_rate: '',
};

export default function LotExpensesPage({ embedded = false, refreshKey = 0 }) {
  const [meta, setMeta] = useState({ lots: [] });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    lot_id: '',
    category: '',
    active: 'true',
    from: '',
    to: '',
  });
  const debouncedCategory = useDebouncedValue(filters.category.trim(), 350);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const flushQueue = useCallback(async () => {
    const jobs = await listPendingJobs('lot_expenses');
    for (const job of jobs) {
      const p = job.payload;
      try {
        if (p.kind === 'create') await createExpense(p.body);
        else if (p.kind === 'update') await updateExpense(p.id, p.body);
        else if (p.kind === 'active') await setExpenseActive(p.id, p.is_active);
        await removePendingJob('lot_expenses', job.id);
      } catch {
        /* sigue en cola */
      }
    }
  }, []);

  const { pendingCount, refresh: refreshPending } = usePendingSyncIds('lot_expenses', { flush: flushQueue });

  async function loadMeta() {
    const data = await getExpensesMeta();
    setMeta({ lots: data?.lots || [] });
  }

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const params = {
        limit: pageSize,
        offset: page * pageSize,
        lot_id: filters.lot_id || undefined,
        category: debouncedCategory || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      };
      const st = String(filters.active ?? '').trim();
      if (st === '1' || st === 'true') params.active = 'true';
      else if (st === '0' || st === 'false') params.active = 'false';
      const data = await listExpenses(params);
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
    loadMeta().catch(() => {});
  }, []);

  useEffect(() => {
    loadList();
  }, [page, filters.lot_id, filters.active, filters.from, filters.to, debouncedCategory, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const lotsByFarm = useMemo(() => {
    const m = new Map();
    (meta.lots || []).forEach((l) => {
      const key = l.farm_name || '—';
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(l);
    });
    return m;
  }, [meta.lots]);

  async function openEdit(id) {
    setModalError('');
    setSaving(true);
    try {
      const row = await getExpense(id);
      setEditingId(id);
      setForm({
        lot_id: row.lot_id || '',
        exp_date: String(row.exp_date || '').slice(0, 10),
        category_id: row.category_id ? String(row.category_id) : '',
        description: row.description || '',
        currency: row.currency || 'CRC',
        amount_input: row.amount_input != null ? String(row.amount_input) : '',
        fx_rate: row.fx_rate != null ? String(row.fx_rate) : '',
      });
      setModalOpen(true);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el gasto.');
    } finally {
      setSaving(false);
    }
  }

  function buildBody() {
    const amount_input = Number(form.amount_input);
    const body = {
      lot_id: form.lot_id,
      exp_date: form.exp_date,
      category_id: form.category_id,
      description: form.description.trim() || null,
      currency: form.currency,
      amount_input,
    };
    if (form.currency === 'USD') body.fx_rate = Number(form.fx_rate);
    return body;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setModalError('');
    setSaving(true);
    const body = buildBody();
    const isNetworkish = (err) =>
      !navigator.onLine ||
      String(err?.message || '')
        .toLowerCase()
        .includes('failed to fetch');
    if (!editingId) {
      setModalError('Solo edición desde aquí. Use Nuevo gasto para registrar.');
      setSaving(false);
      return;
    }
    if (!form.category_id) {
      setModalError('Elija una categoría de la lista o cree una nueva.');
      setSaving(false);
      return;
    }
    try {
      await updateExpense(editingId, body);
      setModalOpen(false);
      await loadList();
    } catch (err) {
      if (isNetworkish(err)) {
        try {
          await enqueuePendingJob('lot_expenses', {
            kind: 'update',
            id: editingId,
            body,
          });
          await refreshPending();
          setModalError('Sin conexión: el cambio quedó en cola para sincronizar cuando vuelva la red.');
        } catch {
          setModalError(err?.message || 'No se pudo guardar.');
        }
      } else {
        setModalError(err?.message || 'No se pudo guardar.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    try {
      await setExpenseActive(row.id, !row.is_active);
      await loadList();
    } catch (err) {
      if (!navigator.onLine || String(err?.message || '').toLowerCase().includes('failed to fetch')) {
        await enqueuePendingJob('lot_expenses', { kind: 'active', id: row.id, is_active: !row.is_active });
        await refreshPending();
        setError('Cambio de estado en cola (sin conexión).');
      } else setError(err?.message || 'No se pudo actualizar.');
    }
  }

  return (
    <div className="space-y-4">
      {pendingCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            Hay {pendingCount} cambio(s) de gastos por lote pendiente(s) de sincronizar.
          </span>
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
          Monto completo a un lote; la finca es dato del lote. Para un alta nuevo use la pestaña <strong>Registrar gasto por lote</strong>.
        </p>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <strong className="text-slate-800">Por lote:</strong> el monto va entero al lote; la finca es dato del lote. Los altas nuevas se hacen con{' '}
          <strong>Nuevo gasto</strong> arriba.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-12 lg:items-end">
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Lote</span>
          <select
            value={filters.lot_id}
            onChange={(e) => {
              setPage(0);
              setFilters((f) => ({ ...f, lot_id: e.target.value }));
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="">Todos</option>
            {[...lotsByFarm.entries()].map(([farm, ls]) => (
              <optgroup key={farm} label={farm}>
                {ls.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
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
            placeholder="Contiene…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="max-h-[min(55vh,32rem)] overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 shadow-sm">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Finca</th>
              <th className="px-3 py-2 text-left">Lote</th>
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-right">Monto CRC</th>
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
                  Sin gastos con estos filtros.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 whitespace-nowrap">{String(r.exp_date || '').slice(0, 10)}</td>
                  <td className="px-3 py-2 text-slate-600">{r.farm_name || '—'}</td>
                  <td className="px-3 py-2">{r.lot_name}</td>
                  <td className="px-3 py-2">{r.category}</td>
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
                      <button
                        type="button"
                        onClick={() => openEdit(r.id)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        Editar
                      </button>
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

      {modalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-lime-800">Editar gasto</h3>
            {modalError ? <p className="mt-2 text-sm text-rose-700">{modalError}</p> : null}
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Lote</span>
                <select
                  required
                  value={form.lot_id}
                  onChange={(e) => setForm((f) => ({ ...f, lot_id: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Seleccione…</option>
                  {[...lotsByFarm.entries()].map(([farm, ls]) => (
                    <optgroup key={farm} label={farm}>
                      {ls.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Fecha</span>
                <input
                  required
                  type="date"
                  value={form.exp_date}
                  onChange={(e) => setForm((f) => ({ ...f, exp_date: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <ExpenseCategoryCombo
                key={editingId || 'edit'}
                valueId={form.category_id}
                onValueChange={(id) => setForm((f) => ({ ...f, category_id: id }))}
              />
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Descripción</span>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Moneda</span>
                <select
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="CRC">CRC</option>
                  <option value="USD">USD</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">Monto ingresado</span>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount_input}
                  onChange={(e) => setForm((f) => ({ ...f, amount_input: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              {form.currency === 'USD' ? (
                <FxRateUsdField
                  required
                  referenceDate={form.exp_date}
                  value={form.fx_rate}
                  onChange={(fx_rate) => setForm((f) => ({ ...f, fx_rate }))}
                />
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-60"
                >
                  {saving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
