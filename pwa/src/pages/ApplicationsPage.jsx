import { useEffect, useMemo, useState } from 'react';
import { getLaborEntriesMeta } from '../services/laborEntries.js';
import { listInventoryItems } from '../services/inventoryItems.js';
import {
  listInventoryConsumptions,
  createInventoryConsumption,
  deactivateInventoryConsumption,
} from '../services/inventoryConsumptions.js';
import { createMixApplication, deactivateMixApplication, getMixApplication, listMixApplications } from '../services/mixApplications.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' });
}

function fmtQty(n) {
  return Number(n || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

/** Fechas del API suelen venir como ISO (`2026-05-12T06:00:00.000Z`); en tablas solo mostramos el día civil. */
function fmtDate(value) {
  if (value == null || value === '') return '—';
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

const DOSE_UNITS = ['kg', 'g', 'litro', 'ml', 'cc', 'unidad', 'onza_liquida', 'onza_masa'];

function sumAllocations(items) {
  return items.reduce((acc, a) => acc + Number(a.allocation_pct || 0), 0);
}

/** Coherente con el API: hay consumos activos vinculados a la mezcla (no solo la bandera en BD). */
function mixHasActiveConsumptions(m) {
  if (m == null) return false;
  if (typeof m.has_active_consumptions === 'boolean') return m.has_active_consumptions;
  return Boolean(m.is_active);
}

export default function ApplicationsPage({ user }) {
  const readOnly = false;

  const [tab, setTab] = useState('list');
  const [meta, setMeta] = useState({ farms: [], lots: [], items: [] });
  const [rows, setRows] = useState([]);
  const [mixRows, setMixRows] = useState([]);
  const [mixDetail, setMixDetail] = useState(null);
  const [mixDetailLoading, setMixDetailLoading] = useState(false);
  const [mixDetailError, setMixDetailError] = useState('');
  const [mixFormError, setMixFormError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /** Misma lógica que registro de labores: alcance por lote o por finca + prorrateo manual si la finca lo define así. */
  const [scope, setScope] = useState({
    cost_scope: 'lot',
    farm_id: '',
    lot_id: '',
    allocations: [],
  });

  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    lot_id: '',
    farm_id: '',
    cost_scope: '',
    active: 'true',
  });

  const [directForm, setDirectForm] = useState({
    cons_date: today(),
    item_id: '',
    qty: '',
    notes: '',
  });

  const [mixForm, setMixForm] = useState({
    app_date: today(),
    containers_used: '',
    notes: '',
    items: [{ item_id: '', dose_qty: '', dose_unit: '' }],
  });

  const farmLots = useMemo(
    () => (meta.lots || []).filter((l) => !scope.farm_id || l.farm_id === scope.farm_id),
    [meta.lots, scope.farm_id]
  );

  const selectedFarmMode = useMemo(
    () => meta.farms.find((f) => f.id === scope.farm_id)?.labor_allocation_mode,
    [meta.farms, scope.farm_id]
  );

  const lotsWithoutArea = useMemo(
    () =>
      farmLots.filter((l) => {
        const area = Number(l.area_ha || 0);
        return !Number.isFinite(area) || area <= 0;
      }),
    [farmLots]
  );

  useEffect(() => {
    (async () => {
      try {
        const [laborMeta, itemsData] = await Promise.all([
          getLaborEntriesMeta(),
          listInventoryItems({ active: 'true' }),
        ]);
        setMeta({
          farms: laborMeta?.farms || [],
          lots: laborMeta?.lots || [],
          items: Array.isArray(itemsData) ? itemsData : [],
        });
      } catch (e) {
        setError(e?.message || 'No se pudo cargar catálogos.');
      }
    })();
  }, [user?.clientId]);

  function setScopeField(field, value) {
    setScope((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'cost_scope') {
        next.farm_id = '';
        next.lot_id = '';
        next.allocations = [];
      }
      if (field === 'farm_id') {
        next.lot_id = '';
        next.allocations = [];
      }
      return next;
    });
  }

  function ensureManualAllocationsSeed() {
    if (!scope.farm_id) return;
    const lots = (meta.lots || []).filter((l) => l.farm_id === scope.farm_id);
    setScope((prev) => ({
      ...prev,
      allocations: lots.map((l) => ({
        lot_id: l.id,
        allocation_pct: lots.length ? roundPct(100 / lots.length) : 0,
      })),
    }));
  }

  function roundPct(n) {
    return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
  }

  function updateAllocation(lotId, pct) {
    setScope((prev) => ({
      ...prev,
      allocations: prev.allocations.map((a) =>
        a.lot_id === lotId ? { ...a, allocation_pct: Number(pct) } : a
      ),
    }));
  }

  async function refreshList() {
    setLoading(true);
    setError('');
    try {
      const [cons, mix] = await Promise.all([
        listInventoryConsumptions({
          from_date: filters.from_date || undefined,
          to_date: filters.to_date || undefined,
          lot_id: filters.lot_id || undefined,
          farm_id: filters.farm_id || undefined,
          active: filters.active,
        }),
        listMixApplications({
          from_date: filters.from_date || undefined,
          to_date: filters.to_date || undefined,
          lot_id: filters.lot_id || undefined,
          farm_id: filters.farm_id || undefined,
          active: filters.active,
        }),
      ]);
      let consRows = Array.isArray(cons) ? cons : [];
      if (filters.cost_scope) {
        consRows = consRows.filter((r) => r.cost_scope === filters.cost_scope);
      }
      setRows(consRows);
      setMixRows(Array.isArray(mix) ? mix : []);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
    }
  }

  async function openMixDetail(mixId) {
    setMixDetailError('');
    setMixDetail(null);
    setMixDetailLoading(true);
    try {
      const data = await getMixApplication(mixId);
      setMixDetail(data);
    } catch (e) {
      setMixDetailError(e?.message || 'No se pudo cargar la mezcla.');
    } finally {
      setMixDetailLoading(false);
    }
  }

  function closeMixDetail() {
    setMixDetail(null);
    setMixDetailError('');
    setMixDetailLoading(false);
  }

  useEffect(() => {
    if (tab === 'list') refreshList();
  }, [tab, filters.from_date, filters.to_date, filters.lot_id, filters.farm_id, filters.active, filters.cost_scope, user?.clientId]);

  function validateScope() {
    if (scope.cost_scope === 'lot') {
      if (!scope.farm_id) return 'Seleccione la finca para filtrar lotes.';
      if (!scope.lot_id) return 'Seleccione el lote.';
    } else {
      if (!scope.farm_id) return 'Seleccione la finca para asignación por finca.';
      const farm = meta.farms.find((f) => f.id === scope.farm_id);
      if (farm?.labor_allocation_mode === 'manual') {
        if (Math.abs(sumAllocations(scope.allocations) - 100) > 0.01) {
          return 'En prorrateo manual, la suma de porcentajes debe ser 100%.';
        }
      }
    }
    return null;
  }

  async function submitDirect(e) {
    e.preventDefault();
    if (readOnly) return;
    setSuccess('');
    setError('');
    const vScope = validateScope();
    if (vScope) {
      setError(vScope);
      return;
    }
    if (!directForm.item_id || !directForm.qty) {
      setError('Insumo y cantidad son obligatorios.');
      return;
    }
    const farm = meta.farms.find((f) => f.id === scope.farm_id);
    const payload = {
      cost_scope: scope.cost_scope,
      lot_id: scope.cost_scope === 'lot' ? scope.lot_id : null,
      farm_id: scope.cost_scope === 'farm' ? scope.farm_id : null,
      item_id: directForm.item_id,
      cons_date: directForm.cons_date,
      qty: Number(directForm.qty),
      notes: directForm.notes.trim() || undefined,
    };
    if (scope.cost_scope === 'farm' && farm?.labor_allocation_mode === 'manual') {
      payload.allocations = scope.allocations.map((a) => ({
        lot_id: a.lot_id,
        allocation_pct: Number(a.allocation_pct || 0),
      }));
    }
    try {
      await createInventoryConsumption(payload);
      setSuccess(
        scope.cost_scope === 'farm'
          ? 'Consumo registrado y prorrateado entre lotes'
          : 'Consumo registrado.'
      );
      setDirectForm({ cons_date: today(), item_id: '', qty: '', notes: '' });
      setTab('list');
      refreshList();
    } catch (err) {
      setError(err?.message || 'No se pudo registrar el consumo.');
    }
  }

  async function submitMix(e) {
    e.preventDefault();
    if (readOnly) return;
    setSuccess('');
    setError('');
    setMixFormError('');
    const vScope = validateScope();
    if (vScope) {
      setMixFormError(vScope);
      return;
    }
    const cu = Number(mixForm.containers_used);
    if (!Number.isFinite(cu) || cu <= 0) {
      setMixFormError('Indique cuántos envases o bombas se usaron (> 0).');
      return;
    }
    const rawMixItems = mixForm.items.filter((x) => x.item_id && x.dose_qty);
    for (const x of rawMixItems) {
      if (!String(x.dose_unit || '').trim()) {
        setMixFormError('Indique la unidad de dosis para cada insumo (ej. kg, litro).');
        return;
      }
    }
    const items = rawMixItems.map((x) => ({
      item_id: x.item_id,
      dose_qty: Number(x.dose_qty),
      dose_unit: String(x.dose_unit || '').trim(),
    }));
    if (!items.length) {
      setMixFormError('Agregue al menos un insumo con dosis.');
      return;
    }
    const farm = meta.farms.find((f) => f.id === scope.farm_id);
    const payload = {
      cost_scope: scope.cost_scope,
      lot_id: scope.cost_scope === 'lot' ? scope.lot_id : null,
      farm_id: scope.cost_scope === 'farm' ? scope.farm_id : null,
      app_date: mixForm.app_date,
      containers_used: cu,
      notes: mixForm.notes.trim() || undefined,
      items,
    };
    if (scope.cost_scope === 'farm' && farm?.labor_allocation_mode === 'manual') {
      payload.allocations = scope.allocations.map((a) => ({
        lot_id: a.lot_id,
        allocation_pct: Number(a.allocation_pct || 0),
      }));
    }
    try {
      await createMixApplication(payload);
      setMixFormError('');
      setSuccess('Mezcla aplicada. Los consumos por insumo quedaron registrados (FIFO).');
      setMixForm({
        app_date: today(),
        containers_used: '',
        notes: '',
        items: [{ item_id: '', dose_qty: '', dose_unit: '' }],
      });
      setTab('list');
      refreshList();
    } catch (err) {
      setMixFormError(err?.message || 'No se pudo registrar la mezcla.');
    }
  }

  async function onInactivate(id) {
    if (readOnly) return;
    if (
      !window.confirm(
        '¿Inactivar este consumo? Si pertenece a un grupo por finca, se inactivarán todos los lotes del grupo y se devolverá el stock.'
      )
    ) {
      return;
    }
    setError('');
    try {
      await deactivateInventoryConsumption(id);
      setSuccess('Consumo(s) inactivado(s).');
      await refreshList();
      const openMixId = mixDetail?.id;
      if (openMixId) {
        try {
          const data = await getMixApplication(openMixId);
          setMixDetail(data);
        } catch {
          closeMixDetail();
        }
      }
    } catch (err) {
      setError(err?.message || 'No se pudo inactivar.');
    }
  }

  async function onDeactivateWholeMix(mixId) {
    if (readOnly) return;
    if (
      !window.confirm(
        '¿Inactivar toda la mezcla? Se inactivarán todos los consumos de inventario vinculados a esta aplicación y se devolverá el stock (FIFO).'
      )
    ) {
      return;
    }
    setError('');
    try {
      await deactivateMixApplication(mixId);
      setSuccess('Mezcla inactivada: todos los consumos asociados quedaron inactivos.');
      await refreshList();
      if (mixDetail?.id === mixId) {
        try {
          const data = await getMixApplication(mixId);
          setMixDetail(data);
        } catch {
          closeMixDetail();
        }
      }
    } catch (err) {
      setError(err?.message || 'No se pudo inactivar la mezcla.');
    }
  }

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header>
        <h3 className="text-base font-semibold text-lime-800">Aplicaciones de insumos</h3>
        <p className="mt-1 text-sm text-slate-600">
          Indique si la asignación del costo de la aplicación es por lote o por finca. Si
          la finca usa prorrateo manual, distribuya el 100% entre sus lotes. El inventario y el costo FIFO los calcula
          el sistema.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
        {[
          { id: 'list', label: 'Historial' },
          { id: 'direct', label: 'Consumo directo' },
          { id: 'mix', label: 'Aplicación por mezcla' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError('');
              setSuccess('');
              setMixFormError('');
            }}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === t.id ? 'bg-lime-700 text-white' : 'bg-white text-slate-700 hover:bg-lime-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-lg border border-lime-200 bg-lime-50 px-3 py-2 text-sm text-lime-900">{success}</div>
      ) : null}

      {tab === 'list' ? (
        <div className="space-y-3">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="block text-xs font-semibold text-slate-700">
              Desde
              <input
                type="date"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.from_date}
                onChange={(e) => setFilter('from_date', e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Hasta
              <input
                type="date"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.to_date}
                onChange={(e) => setFilter('to_date', e.target.value)}
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Alcance
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.cost_scope}
                onChange={(e) => setFilter('cost_scope', e.target.value)}
              >
                <option value="">Todos</option>
                <option value="lot">Por lote</option>
                <option value="farm">Por finca</option>
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Finca
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.farm_id}
                onChange={(e) => setFilter('farm_id', e.target.value)}
              >
                <option value="">Todas</option>
                {(meta.farms || []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Lote
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.lot_id}
                onChange={(e) => setFilter('lot_id', e.target.value)}
              >
                <option value="">Todos</option>
                {(meta.lots || []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Estado
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={filters.active}
                onChange={(e) => setFilter('active', e.target.value)}
              >
                <option value="all">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
            </label>
          </div>

          <p className="text-xs text-slate-600">
            Fechas, finca, lote y estado aplican a <strong>Consumos de inventario</strong> y a{' '}
            <strong>Listado de mezclas</strong>. El filtro <strong>Alcance</strong> solo afecta la tabla de
            consumos.
          </p>

          <h4 className="text-sm font-semibold text-slate-800">Consumos de inventario</h4>
          <div className="max-h-[min(55vh,28rem)] overflow-y-auto overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase text-slate-600 shadow-sm">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Alcance</th>
                  <th className="px-3 py-2">Lote / Finca</th>
                  <th className="px-3 py-2">Insumo</th>
                  <th className="px-3 py-2">Cant.</th>
                  <th className="px-3 py-2">Monto</th>
                  <th className="px-3 py-2">Mezcla</th>
                  <th className="px-3 py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                      Cargando…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                      Sin consumos con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.cons_date)}</td>
                      <td className="px-3 py-2">{r.cost_scope === 'farm' ? 'Finca' : 'Lote'}</td>
                      <td className="px-3 py-2">
                        {r.cost_scope === 'farm' ? r.farm_name || '—' : r.lot_name}
                        {r.cost_scope === 'farm' ? (
                          <span className="block text-xs text-slate-500">Lote costo: {r.lot_name}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {r.item_name} <span className="text-slate-500">({r.item_unit})</span>
                      </td>
                      <td className="px-3 py-2">{fmtQty(r.qty)}</td>
                      <td className="px-3 py-2">{fmtMoney(r.amount)}</td>
                      <td className="px-3 py-2 text-xs">{r.mix_application_id ? 'Sí' : '—'}</td>
                      <td className="px-3 py-2">
                        {r.is_active && !readOnly ? (
                          <button
                            type="button"
                            className="text-rose-700 underline text-xs"
                            onClick={() => onInactivate(r.id)}
                          >
                            Inactivar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h4 className="text-sm font-semibold text-slate-800">Listado de mezclas</h4>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Alcance</th>
                  <th className="px-3 py-2">Ubicación</th>
                  <th className="px-3 py-2">Envases</th>
                  <th className="px-3 py-2">Costo total</th>
                  <th className="px-3 py-2">Notas</th>
                  <th className="px-3 py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {mixRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-slate-500">
                      Sin mezclas registradas.
                    </td>
                  </tr>
                ) : (
                  mixRows.map((m) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDate(m.app_date)}</td>
                      <td className="px-3 py-2">{m.cost_scope === 'farm' ? 'Finca' : 'Lote'}</td>
                      <td className="px-3 py-2">{m.scope_name || m.lot_name || m.farm_name || '—'}</td>
                      <td className="px-3 py-2">{fmtQty(m.containers_used)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-700" title="Suma de montos de consumos vinculados (CRC)">
                        {fmtMoney(m.total_cost_crc)}
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate">{m.notes || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          className="text-xs font-semibold text-lime-800 underline"
                          onClick={() => openMixDetail(m.id)}
                        >
                          Ver
                        </button>
                        {!readOnly && mixHasActiveConsumptions(m) ? (
                          <>
                            <span className="mx-1 text-slate-300">|</span>
                            <button
                              type="button"
                              className="text-xs font-semibold text-rose-700 underline"
                              onClick={() => onDeactivateWholeMix(m.id)}
                            >
                              Inactivar
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === 'direct' || tab === 'mix' ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
          <fieldset className="grid gap-3 lg:grid-cols-3">
            <legend className="sr-only">Alcance del costo</legend>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-800">Asignar costo por *</span>
              <select
                className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                value={scope.cost_scope}
                onChange={(e) => setScopeField('cost_scope', e.target.value)}
              >
                <option value="lot">Por lote</option>
                <option value="farm">Por finca (prorrateo entre lotes)</option>
              </select>
            </label>

            {scope.cost_scope === 'farm' ? (
              <label className="text-sm">
                <span className="mb-1 block font-medium text-slate-800">Finca *</span>
                <select
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  value={scope.farm_id}
                  onChange={(e) => setScopeField('farm_id', e.target.value)}
                >
                  <option value="">Seleccione…</option>
                  {(meta.farms || []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-800">Finca *</span>
                  <select
                    className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                    value={scope.farm_id}
                    onChange={(e) => setScopeField('farm_id', e.target.value)}
                  >
                    <option value="">Seleccione…</option>
                    {(meta.farms || []).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-800">Lote *</span>
                  <select
                    className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                    value={scope.lot_id}
                    onChange={(e) => setScopeField('lot_id', e.target.value)}
                    disabled={!scope.farm_id}
                  >
                    <option value="">{scope.farm_id ? 'Seleccione lote' : 'Primero la finca'}</option>
                    {farmLots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </fieldset>

          {scope.cost_scope === 'farm' && selectedFarmMode === 'manual' ? (
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Prorrateo manual (%)</span>
                <button
                  type="button"
                  onClick={ensureManualAllocationsSeed}
                  className="rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs"
                >
                  Cargar lotes
                </button>
              </div>
              {scope.allocations.length === 0 ? (
                <p className="text-sm text-slate-500">Pulse «Cargar lotes» para repartir el 100% entre lotes.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {scope.allocations.map((a) => {
                    const lot = farmLots.find((l) => l.id === a.lot_id);
                    return (
                      <label key={a.lot_id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{lot?.name || a.lot_id}</span>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          max="100"
                          value={a.allocation_pct}
                          onChange={(e) => updateAllocation(a.lot_id, e.target.value)}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-right"
                        />
                      </label>
                    );
                  })}
                  <p className="md:col-span-2 text-xs text-slate-600">Suma: {sumAllocations(scope.allocations).toFixed(3)}%</p>
                </div>
              )}
            </div>
          ) : null}

          {scope.cost_scope === 'farm' && selectedFarmMode === 'area' && lotsWithoutArea.length > 0 ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Esta finca prorratea por área. Los lotes sin área quedarán con 0%:{' '}
              {lotsWithoutArea.map((l) => l.name).join(', ')}.
            </p>
          ) : null}

          {tab === 'direct' ? (
            <form onSubmit={submitDirect} className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                Fecha de consumo *
                <input
                  type="date"
                  required
                  className="mt-1 w-full max-w-xs rounded border border-slate-300 px-2 py-2 text-sm"
                  value={directForm.cons_date}
                  onChange={(e) => setDirectForm((p) => ({ ...p, cons_date: e.target.value }))}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Insumo *
                <select
                  required
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  value={directForm.item_id}
                  onChange={(e) => setDirectForm((p) => ({ ...p, item_id: e.target.value }))}
                >
                  <option value="">Seleccione…</option>
                  {(meta.items || []).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.unit})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">
                Cantidad total (unidad del insumo) *
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  value={directForm.qty}
                  onChange={(e) => setDirectForm((p) => ({ ...p, qty: e.target.value }))}
                />
              </label>
              <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">
                Notas
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  rows={2}
                  value={directForm.notes}
                  onChange={(e) => setDirectForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={readOnly}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Registrar consumo
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitMix} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700">
                  Fecha de aplicación *
                  <input
                    type="date"
                    required
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                    value={mixForm.app_date}
                    onChange={(e) => setMixForm((p) => ({ ...p, app_date: e.target.value }))}
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-700">
                  Envases / bombas usados *
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                    value={mixForm.containers_used}
                    onChange={(e) => setMixForm((p) => ({ ...p, containers_used: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-xs font-semibold text-slate-700">
                Notas
                <textarea
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  rows={2}
                  value={mixForm.notes}
                  onChange={(e) => setMixForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </label>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-slate-800">Insumos de la mezcla</div>
                <p className="text-xs text-slate-600">
                  Dosis <strong>por envase</strong>; el sistema convierte a la unidad del catálogo y multiplica por
                  envases. Con alcance por finca, cada insumo se prorratea entre lotes igual que arriba.
                </p>
                {mixForm.items.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-2"
                  >
                    <label className="min-w-[180px] flex-1 text-xs font-semibold text-slate-700">
                      Insumo
                      <select
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={row.item_id}
                        onChange={(e) => {
                          const next = [...mixForm.items];
                          next[idx] = { ...next[idx], item_id: e.target.value };
                          setMixForm((p) => ({ ...p, items: next }));
                        }}
                      >
                        <option value="">—</option>
                        {(meta.items || []).map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} ({it.unit})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="w-28 text-xs font-semibold text-slate-700">
                      Dosis
                      <input
                        type="number"
                        step="any"
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={row.dose_qty}
                        onChange={(e) => {
                          const next = [...mixForm.items];
                          next[idx] = { ...next[idx], dose_qty: e.target.value };
                          setMixForm((p) => ({ ...p, items: next }));
                        }}
                      />
                    </label>
                    <label className="w-36 text-xs font-semibold text-slate-700">
                      Unidad dosis
                      <input
                        list={`dose-units-${idx}`}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                        value={row.dose_unit}
                        onChange={(e) => {
                          const next = [...mixForm.items];
                          next[idx] = { ...next[idx], dose_unit: e.target.value };
                          setMixForm((p) => ({ ...p, items: next }));
                        }}
                      />
                      <datalist id={`dose-units-${idx}`}>
                        {DOSE_UNITS.map((u) => (
                          <option key={u} value={u} />
                        ))}
                      </datalist>
                    </label>
                    {mixForm.items.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs text-rose-700 underline"
                        onClick={() => {
                          const next = mixForm.items.filter((_, i) => i !== idx);
                          setMixForm((p) => ({
                            ...p,
                            items: next.length ? next : [{ item_id: '', dose_qty: '', dose_unit: '' }],
                          }));
                        }}
                      >
                        Quitar
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  className="text-sm text-lime-800 underline"
                  onClick={() =>
                    setMixForm((p) => ({
                      ...p,
                      items: [...p.items, { item_id: '', dose_qty: '', dose_unit: '' }],
                    }))
                  }
                >
                  + Agregar insumo
                </button>
              </div>

              {mixFormError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {mixFormError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={readOnly}
                className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Registrar mezcla y consumos
              </button>
            </form>
          )}
        </div>
      ) : null}

      {mixDetail || mixDetailLoading || mixDetailError ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mix-detail-title"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-2">
              <h4 id="mix-detail-title" className="text-lg font-semibold text-lime-900">
                Detalle de mezcla
              </h4>
              <button
                type="button"
                className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
                onClick={closeMixDetail}
              >
                Cerrar
              </button>
            </div>
            {mixDetailLoading ? (
              <p className="text-sm text-slate-600">Cargando…</p>
            ) : mixDetailError ? (
              <p className="text-sm text-rose-700">{mixDetailError}</p>
            ) : mixDetail ? (
              <>
                <div className="mb-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <p>
                    <span className="font-semibold text-slate-900">Fecha:</span> {fmtDate(mixDetail.app_date)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Alcance:</span>{' '}
                    {mixDetail.cost_scope === 'farm' ? 'Finca' : 'Lote'}
                  </p>
                  <p className="sm:col-span-2">
                    <span className="font-semibold text-slate-900">Ubicación:</span>{' '}
                    {mixDetail.scope_name || mixDetail.lot_name || mixDetail.farm_name || '—'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Envases / bombas:</span>{' '}
                    {fmtQty(mixDetail.containers_used)}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-900">Cabecera:</span>{' '}
                    {mixHasActiveConsumptions(mixDetail) ? 'Activa' : 'Inactiva'}
                  </p>
                  {mixDetail.notes ? (
                    <p className="sm:col-span-2">
                      <span className="font-semibold text-slate-900">Notas:</span> {mixDetail.notes}
                    </p>
                  ) : null}
                </div>
                {!readOnly && mixHasActiveConsumptions(mixDetail) ? (
                  <div className="mb-3">
                    <button
                      type="button"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
                      onClick={() => onDeactivateWholeMix(mixDetail.id)}
                    >
                      Inactivar toda la mezcla
                    </button>
                  </div>
                ) : null}
                <p className="mb-2 text-xs text-slate-500">
                  Cantidad total = dosis por envase × envases (en la unidad del catálogo del insumo).
                </p>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Insumo</th>
                        <th className="px-3 py-2">Dosis / envase</th>
                        <th className="px-3 py-2">Unidad dosis</th>
                        <th className="px-3 py-2">Dosis (u. cat.)</th>
                        <th className="px-3 py-2">Total aplicado</th>
                        <th className="px-3 py-2">Línea</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mixDetail.items || []).map((it) => (
                        <tr key={it.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            {it.item_name} <span className="text-slate-500">({it.item_unit})</span>
                          </td>
                          <td className="px-3 py-2">{fmtQty(it.dose_qty)}</td>
                          <td className="px-3 py-2">{it.dose_unit}</td>
                          <td className="px-3 py-2">{fmtQty(it.dose_qty_base)}</td>
                          <td className="px-3 py-2">{fmtQty(it.total_qty)}</td>
                          <td className="px-3 py-2">
                            {it.line_active === true ? (
                              <span className="text-lime-800">Activa</span>
                            ) : (
                              <span className="text-rose-700">Inactiva</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
