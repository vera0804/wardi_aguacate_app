import { useEffect, useMemo, useState } from 'react';
import {
  createLaborEntriesBulk,
  createLaborEntry,
  getLaborEntriesMeta,
  getLaborSummaryByLot,
  getLaborSummaryByWorker,
  setLaborEntryActive,
  updateLaborEntry,
  listLaborEntries,
} from '../services/laborEntries.js';

const DEFAULT_FORM = {
  cost_scope: 'lot',
  farm_id: '',
  lot_id: '',
  worker_id: '',
  labor_type_id: '',
  harvest_id: '',
  work_date: '',
  from_date: '',
  to_date: '',
  is_bulk: false,
  is_multi_worker: false,
  worker_entries: [],
  unit: 'jornal',
  qty: '1',
  rate_applied: '',
  notes: '',
  allocations: [],
};

function workerLabel(w) {
  return [w.first_name, w.last_name_1, w.last_name_2].filter(Boolean).join(' ');
}

function dateToday() {
  return new Date().toISOString().slice(0, 10);
}

function unitLabel(unit) {
  const v = String(unit || '').toLowerCase();
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function sumAllocations(items) {
  return items.reduce((acc, a) => acc + Number(a.allocation_pct || 0), 0);
}

export default function LaborEntriesPage({ user }) {
  const [meta, setMeta] = useState({
    farms: [],
    lots: [],
    workers: [],
    laborTypes: [],
    units: ['jornal', 'hora', 'caja', 'bolsas'],
  });
  const [rows, setRows] = useState([]);
  const [summaryLot, setSummaryLot] = useState([]);
  const [summaryWorker, setSummaryWorker] = useState([]);
  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    cost_scope: '',
    active: 'true',
    farm_id: '',
    worker_id: '',
  });
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    ...DEFAULT_FORM,
    work_date: dateToday(),
    from_date: dateToday(),
    to_date: dateToday(),
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [modalError, setModalError] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [laborTypeSearch, setLaborTypeSearch] = useState('');
  const [dailyQtyByDate, setDailyQtyByDate] = useState({});
  const [workerPickId, setWorkerPickId] = useState('');

  const readOnly = false;

  const farmLots = useMemo(
    () => meta.lots.filter((l) => l.farm_id === form.farm_id),
    [meta.lots, form.farm_id]
  );

  const selectedWorker = useMemo(
    () => meta.workers.find((w) => w.id === form.worker_id),
    [meta.workers, form.worker_id]
  );
  const isFixedWorker = selectedWorker?.worker_type === 'fijo';

  useEffect(() => {
    (async () => {
      try {
        const data = await getLaborEntriesMeta();
        setMeta({
          farms: data?.farms || [],
          lots: data?.lots || [],
          workers: data?.workers || [],
          laborTypes: data?.laborTypes || [],
          units: data?.units || ['jornal', 'hora', 'caja', 'bolsas'],
        });
      } catch (e) {
        setListError(e?.message || 'No se pudo cargar metadata de labores.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!showModal || !form.worker_id) return;
    const w = meta.workers.find((x) => x.id === form.worker_id);
    if (w?.worker_type !== 'fijo') return;
    setForm((prev) => {
      if (String(prev.rate_applied) === '0') return prev;
      return { ...prev, rate_applied: '0' };
    });
  }, [showModal, form.worker_id, meta.workers]);

  async function refresh() {
    setLoading(true);
    setListError('');
    try {
      const [entries, lotS, workerS] = await Promise.all([
        listLaborEntries(filters),
        getLaborSummaryByLot(filters),
        getLaborSummaryByWorker(filters),
      ]);
      setRows(entries || []);
      setSummaryLot(lotS || []);
      setSummaryWorker(workerS || []);
    } catch (e) {
      setListError(e?.message || 'No se pudo cargar registro de labores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [filters.from_date, filters.to_date, filters.cost_scope, filters.active, filters.farm_id, filters.worker_id]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function resetForm() {
    setForm({
      ...DEFAULT_FORM,
      work_date: dateToday(),
      from_date: dateToday(),
      to_date: dateToday(),
    });
    setEditingId(null);
    setDailyQtyByDate({});
    setLaborTypeSearch('');
    setWorkerPickId('');
  }

  function workerById(workerId) {
    return meta.workers.find((w) => w.id === workerId);
  }

  function isFixedWorkerId(workerId) {
    return workerById(workerId)?.worker_type === 'fijo';
  }

  function addWorkerEntry(workerId) {
    if (!workerId) return;
    if (form.worker_entries.some((e) => e.worker_id === workerId)) {
      setModalError('Ese trabajador ya está en la lista.');
      return;
    }
    setModalError('');
    const fixed = isFixedWorkerId(workerId);
    setForm((prev) => ({
      ...prev,
      worker_entries: [
        ...prev.worker_entries,
        { worker_id: workerId, rate_applied: fixed ? '0' : '' },
      ],
    }));
    setWorkerPickId('');
  }

  function removeWorkerEntry(workerId) {
    setForm((prev) => ({
      ...prev,
      worker_entries: prev.worker_entries.filter((e) => e.worker_id !== workerId),
    }));
  }

  function updateWorkerEntryRate(workerId, rate) {
    setForm((prev) => ({
      ...prev,
      worker_entries: prev.worker_entries.map((e) =>
        e.worker_id === workerId ? { ...e, rate_applied: rate } : e
      ),
    }));
  }

  const availableWorkersToAdd = useMemo(() => {
    const selected = new Set(form.worker_entries.map((e) => e.worker_id));
    return meta.workers.filter((w) => !selected.has(w.id));
  }, [meta.workers, form.worker_entries]);

  function openCreate() {
    resetForm();
    setModalError('');
    setShowModal(true);
  }

  function openEdit(row) {
    const derivedFarmId =
      row.farm_id ||
      meta.lots.find((l) => l.id === row.lot_id)?.farm_id ||
      '';
    setEditingId(row.id);
    setForm({
      ...DEFAULT_FORM,
      cost_scope: row.cost_scope,
      farm_id: derivedFarmId,
      lot_id: row.lot_id || '',
      worker_id: row.worker_id || '',
      labor_type_id: row.labor_type_id || '',
      work_date: String(row.work_date).slice(0, 10),
      unit: row.unit,
      qty: String(row.qty ?? ''),
      rate_applied: String(row.rate_applied ?? ''),
      notes: row.notes || '',
      allocations: (row.allocations || []).map((a) => ({
        lot_id: a.lot_id,
        allocation_pct: String(a.allocation_pct),
      })),
      is_bulk: false,
      is_multi_worker: false,
      worker_entries: [],
      from_date: dateToday(),
      to_date: dateToday(),
    });
    setLaborTypeSearch(row.labor_type_name || '');
    setModalError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setModalError('');
    resetForm();
  }

  function onChange(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'cost_scope') {
        if (value === 'lot') {
          next.farm_id = '';
          next.allocations = [];
        } else {
          next.lot_id = '';
        }
      }
      if (field === 'farm_id') {
        next.lot_id = '';
        next.allocations = [];
      }
      if (field === 'unit' && value === 'jornal') {
        next.qty = '1';
      }
      if (field === 'is_multi_worker') {
        if (value) {
          next.worker_id = '';
          next.rate_applied = '';
        } else {
          next.worker_entries = [];
        }
      }
      if (field === 'worker_id' && value) {
        next.is_multi_worker = false;
        next.worker_entries = [];
      }
      return next;
    });
    if (
      field === 'from_date' ||
      field === 'to_date' ||
      field === 'unit' ||
      field === 'qty' ||
      field === 'is_bulk' ||
      field === 'is_multi_worker'
    ) {
      setDailyQtyByDate({});
    }
    if (field === 'is_multi_worker' && !value) {
      setWorkerPickId('');
    }
  }

  function onLaborTypeSearchChange(value) {
    setLaborTypeSearch(value);
    const exact = meta.laborTypes.find(
      (t) => String(t.name || '').trim().toLowerCase() === String(value || '').trim().toLowerCase()
    );
    onChange('labor_type_id', exact ? exact.id : '');
  }

  function ensureManualAllocationsSeed() {
    if (!form.farm_id) return;
    if (form.allocations.length) return;
    setForm((prev) => ({
      ...prev,
      allocations: farmLots.map((l) => ({
        lot_id: l.id,
        allocation_pct: '0',
      })),
    }));
  }

  function updateAllocation(lotId, value) {
    setForm((prev) => ({
      ...prev,
      allocations: prev.allocations.map((a) =>
        a.lot_id === lotId ? { ...a, allocation_pct: value } : a
      ),
    }));
  }

  function validateForm() {
    if (!form.labor_type_id) {
      return 'El tipo de labor es obligatorio.';
    }
    const isMultiCreate = form.is_multi_worker && !editingId;
    if (isMultiCreate) {
      if (!form.worker_entries.length) {
        return 'Agrega al menos un trabajador.';
      }
      for (const entry of form.worker_entries) {
        if (!entry.worker_id) continue;
        if (isFixedWorkerId(entry.worker_id)) continue;
        if (
          entry.rate_applied === '' ||
          entry.rate_applied === undefined ||
          Number(entry.rate_applied) < 0
        ) {
          const label = workerById(entry.worker_id)?.display_name || workerLabel(workerById(entry.worker_id) || {});
          return `Indica la tarifa para ${label || 'cada trabajador'}.`;
        }
      }
    } else if (!form.worker_id) {
      return 'El trabajador es obligatorio.';
    }
    if (!form.unit) return 'La unidad es obligatoria.';
    if (!isMultiCreate) {
      const selWorker = meta.workers.find((w) => w.id === form.worker_id);
      const fixed = selWorker?.worker_type === 'fijo';
      if (!fixed) {
        if (form.rate_applied === '' || form.rate_applied === undefined || Number(form.rate_applied) < 0) {
          return 'La tarifa aplicada debe ser mayor o igual a 0.';
        }
      }
    }
    const isBulkCreate = form.is_bulk && !editingId;
    const isBulkOrMulti = (form.is_bulk || form.is_multi_worker) && !editingId;
    if (!isBulkCreate) {
      if (!form.qty || Number(form.qty) <= 0) {
        return 'La cantidad debe ser mayor que 0.';
      }
      if (form.unit === 'jornal' && Number(form.qty) !== 1) {
        return 'Para unidad jornal, la cantidad debe ser 1.';
      }
    }
    if (form.cost_scope === 'lot' && !form.lot_id) {
      return 'Debes seleccionar un lote para alcance por lote.';
    }
    if (form.cost_scope === 'lot' && !form.farm_id) {
      return 'Debes seleccionar una finca para filtrar lotes.';
    }
    if (form.cost_scope === 'farm' && !form.farm_id) {
      return 'Debes seleccionar una finca para alcance por finca.';
    }
    if (form.cost_scope === 'farm') {
      const farm = meta.farms.find((f) => f.id === form.farm_id);
      if (farm?.labor_allocation_mode === 'manual') {
        const total = sumAllocations(form.allocations);
        if (Math.abs(total - 100) > 0.01) {
          return 'En asignación manual, la suma de porcentajes debe ser 100.';
        }
      }
    }
    if (isBulkOrMulti && form.is_bulk) {
      if (!form.from_date || !form.to_date) return 'Debes indicar rango de fechas.';
      if (form.from_date > form.to_date) return 'Rango de fechas inválido.';
      if (form.unit !== 'jornal') {
        const hasInvalid = bulkDates.some((d) => qtyForDate(d) <= 0 || !Number.isFinite(qtyForDate(d)));
        if (hasInvalid) return 'En carga por rango, cada día debe tener cantidad mayor que 0.';
      }
    } else if (!form.work_date) {
      return 'La fecha de trabajo es obligatoria.';
    }
    return null;
  }

  function sharedPayloadFields() {
    const payload = {
      cost_scope: form.cost_scope,
      lot_id: form.cost_scope === 'lot' ? form.lot_id : null,
      farm_id: form.cost_scope === 'farm' ? form.farm_id : null,
      labor_type_id: form.labor_type_id,
      unit: form.unit,
      qty: Number(form.qty),
      notes: form.notes.trim() || null,
    };
    if (form.cost_scope === 'farm') {
      const farm = meta.farms.find((f) => f.id === form.farm_id);
      if (farm?.labor_allocation_mode === 'manual') {
        payload.allocations = form.allocations.map((a) => ({
          lot_id: a.lot_id,
          allocation_pct: Number(a.allocation_pct || 0),
        }));
      }
    }
    return payload;
  }

  function attachDateFields(payload) {
    if (form.is_bulk) {
      payload.from_date = form.from_date;
      payload.to_date = form.to_date;
      payload.daily_items = bulkDates.map((d) => ({
        work_date: d,
        qty: qtyForDate(d),
      }));
    } else {
      payload.work_date = form.work_date;
      payload.from_date = form.work_date;
      payload.to_date = form.work_date;
    }
    return payload;
  }

  function toPayload() {
    const payload = {
      ...sharedPayloadFields(),
      worker_id: form.worker_id,
      rate_applied: isFixedWorker ? 0 : Number(form.rate_applied),
    };
    if (form.is_bulk) {
      attachDateFields(payload);
    } else {
      payload.work_date = form.work_date;
    }
    return payload;
  }

  function toMultiWorkerPayload() {
    const payload = {
      ...sharedPayloadFields(),
      workers: form.worker_entries.map((e) => ({
        worker_id: e.worker_id,
        rate_applied: isFixedWorkerId(e.worker_id) ? 0 : Number(e.rate_applied),
      })),
    };
    return attachDateFields(payload);
  }

  async function submit(e) {
    e.preventDefault();
    if (readOnly) return;

    const validation = validateForm();
    if (validation) {
      setModalError(validation);
      return;
    }

    const payload = form.is_multi_worker && !editingId ? toMultiWorkerPayload() : toPayload();
    setSaving(true);
    setModalError('');
    try {
      if (editingId) {
        await updateLaborEntry(editingId, payload);
      } else if (form.is_multi_worker || form.is_bulk) {
        await createLaborEntriesBulk(payload);
      } else {
        await createLaborEntry(payload);
      }
      closeModal();
      await refresh();
    } catch (e2) {
      setModalError(e2?.message || 'No se pudo guardar el registro de labor.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    if (readOnly) return;
    const action = row.is_active ? 'inactivar' : 'activar';
    if (!window.confirm(`¿Deseas ${action} este registro?`)) return;
    setSaving(true);
    setListError('');
    try {
      await setLaborEntryActive(row.id, !row.is_active);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo actualizar el estado.');
    } finally {
      setSaving(false);
    }
  }

  const selectedFarmMode = useMemo(
    () => meta.farms.find((f) => f.id === form.farm_id)?.labor_allocation_mode,
    [meta.farms, form.farm_id]
  );

  const lotsWithoutArea = useMemo(
    () =>
      farmLots.filter((l) => {
        const area = Number(l.area_ha || 0);
        return !Number.isFinite(area) || area <= 0;
      }),
    [farmLots]
  );

  const filteredLaborTypes = useMemo(() => {
    const term = String(laborTypeSearch || '').trim().toLowerCase();
    if (!term) return meta.laborTypes;
    return meta.laborTypes.filter((t) =>
      String(t.name || '').toLowerCase().includes(term)
    );
  }, [meta.laborTypes, laborTypeSearch]);

  const bulkDates = useMemo(() => {
    if (!form.is_bulk || !form.from_date || !form.to_date || form.from_date > form.to_date) {
      return [];
    }
    const out = [];
    let current = new Date(`${form.from_date}T00:00:00`);
    const end = new Date(`${form.to_date}T00:00:00`);
    while (current <= end) {
      out.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }
    return out;
  }, [form.is_bulk, form.from_date, form.to_date]);

  function qtyForDate(date) {
    if (form.unit === 'jornal') return 1;
    const specific = dailyQtyByDate[date];
    if (specific === undefined || specific === null || specific === '') {
      return Number(form.qty || 0);
    }
    return Number(specific || 0);
  }

  const multiCreateCount = useMemo(() => {
    if (!form.is_multi_worker || editingId) return 0;
    const workers = form.worker_entries.length;
    if (!workers) return 0;
    const days = form.is_bulk ? bulkDates.length : 1;
    return workers * days;
  }, [form.is_multi_worker, form.worker_entries.length, form.is_bulk, bulkDates.length, editingId]);

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Registro de labores</h3>
          <p className="text-sm text-slate-600">Registro por lote o por finca con asignación de costos.</p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={openCreate}
            disabled={saving}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Nuevo registro
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <input type="date" value={filters.from_date} onChange={(e) => setFilter('from_date', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
        <input type="date" value={filters.to_date} onChange={(e) => setFilter('to_date', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm" />
        <select value={filters.cost_scope} onChange={(e) => setFilter('cost_scope', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todos los alcances</option>
          <option value="lot">Por lote</option>
          <option value="farm">Por finca</option>
        </select>
        <select value={filters.active} onChange={(e) => setFilter('active', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select value={filters.farm_id} onChange={(e) => setFilter('farm_id', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todas las fincas</option>
          {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={filters.worker_id} onChange={(e) => setFilter('worker_id', e.target.value)} className="rounded border border-slate-300 px-3 py-2 text-sm">
          <option value="">Todos los trabajadores</option>
          {meta.workers.map((w) => <option key={w.id} value={w.id}>{w.display_name || workerLabel(w)}</option>)}
        </select>
      </div>

      {listError ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{listError}</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowSummary((v) => !v)}
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {showSummary ? 'Ocultar resumen' : 'Ver resumen'}
        </button>
      </div>

      {showSummary ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-800">Resumen por lote</h4>
            <div className="max-h-40 overflow-auto text-sm">
              {summaryLot.length ? summaryLot.map((r) => (
                <div key={r.lot_id} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{r.lot_name || 'Sin lote'}</span>
                  <span>{Number(r.total_amount || 0).toFixed(2)}</span>
                </div>
              )) : <p className="text-slate-500">Sin datos.</p>}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-800">Resumen por trabajador</h4>
            <div className="max-h-40 overflow-auto text-sm">
              {summaryWorker.length ? summaryWorker.map((r) => (
                <div key={r.worker_id} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{r.worker_name}</span>
                  <span>{Number(r.total_amount || 0).toFixed(2)}</span>
                </div>
              )) : <p className="text-slate-500">Sin datos.</p>}
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Alcance</th>
              <th className="px-3 py-2 text-left">Finca/Lote</th>
              <th className="px-3 py-2 text-left">Trabajador</th>
              <th className="px-3 py-2 text-left">Labor</th>
              <th className="px-3 py-2 text-left">Monto</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Cargando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-4 text-center text-slate-500">Sin registros.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-200">
                <td className="px-3 py-2">{String(r.work_date).slice(0, 10)}</td>
                <td className="px-3 py-2">{r.cost_scope === 'farm' ? 'Finca' : 'Lote'}</td>
                <td className="px-3 py-2">{r.cost_scope === 'farm' ? r.farm_name : r.lot_name}</td>
                <td className="px-3 py-2">{[r.first_name, r.last_name_1, r.last_name_2].filter(Boolean).join(' ')}</td>
                <td className="px-3 py-2">{r.labor_type_name}</td>
                <td className="px-3 py-2">{Number(r.amount || 0).toFixed(2)}</td>
                <td className="px-3 py-2">{r.is_active ? 'Activo' : 'Inactivo'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openEdit(r)} disabled={readOnly || saving} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">Editar</button>
                    <button type="button" onClick={() => toggleActive(r)} disabled={readOnly || saving} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
                      {r.is_active ? 'Inactivar' : 'Activar'}
                    </button>
                  </div>
                  {r.cost_scope === 'farm' && r.allocations?.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Prorrateo: {r.allocations.map((a) => `${a.lot_name} ${Number(a.allocation_pct).toFixed(2)}%`).join(' · ')}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-800">{editingId ? 'Editar labor' : 'Nueva labor'}</h4>
              <button type="button" onClick={closeModal} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">Cerrar</button>
            </div>

            <form onSubmit={submit} className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Asignar por:</span>
                <select value={form.cost_scope} onChange={(e) => onChange('cost_scope', e.target.value)} disabled={saving || !!editingId} className="w-full rounded border border-slate-300 px-3 py-2">
                  <option value="lot">Por lote</option>
                  <option value="farm">Por finca</option>
                </select>
              </label>

              {form.cost_scope === 'farm' ? (
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Finca *</span>
                  <select value={form.farm_id} onChange={(e) => onChange('farm_id', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2">
                    <option value="">Selecciona finca</option>
                    {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Finca *</span>
                    <select value={form.farm_id} onChange={(e) => onChange('farm_id', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2">
                      <option value="">Selecciona finca</option>
                      {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Lote *</span>
                    <select value={form.lot_id} onChange={(e) => onChange('lot_id', e.target.value)} disabled={saving || !form.farm_id} className="w-full rounded border border-slate-300 px-3 py-2">
                      <option value="">{form.farm_id ? 'Selecciona lote' : 'Primero selecciona finca'}</option>
                      {farmLots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </label>
                </>
              )}

              {!editingId ? (
                <label className="inline-flex items-center gap-2 text-sm lg:col-span-3">
                  <input
                    type="checkbox"
                    checked={form.is_multi_worker}
                    onChange={(e) => onChange('is_multi_worker', e.target.checked)}
                    disabled={saving}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Varios trabajadores (misma labor, fecha y alcance; tarifa por persona)
                </label>
              ) : null}

              {form.is_multi_worker && !editingId ? (
                <div className="lg:col-span-3 rounded border border-lime-200 bg-lime-50/60 p-3">
                  <p className="mb-2 text-sm font-semibold text-lime-900">Trabajadores seleccionados</p>
                  <div className="mb-3 flex flex-wrap items-end gap-2">
                    <label className="min-w-[12rem] flex-1 text-sm">
                      <span className="mb-1 block font-medium">Agregar trabajador</span>
                      <select
                        value={workerPickId}
                        onChange={(e) => setWorkerPickId(e.target.value)}
                        disabled={saving || availableWorkersToAdd.length === 0}
                        className="w-full rounded border border-slate-300 px-3 py-2"
                      >
                        <option value="">
                          {availableWorkersToAdd.length ? 'Selecciona trabajador' : 'No hay más trabajadores'}
                        </option>
                        {availableWorkersToAdd.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.display_name || workerLabel(w)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => addWorkerEntry(workerPickId)}
                      disabled={saving || !workerPickId}
                      className="rounded border border-lime-700 bg-white px-3 py-2 text-sm font-medium text-lime-800 disabled:opacity-50"
                    >
                      Agregar
                    </button>
                  </div>
                  {form.worker_entries.length === 0 ? (
                    <p className="text-sm text-slate-600">Agrega uno o más trabajadores y asigna la tarifa de cada uno.</p>
                  ) : (
                    <div className="space-y-2">
                      {form.worker_entries.map((entry) => {
                        const w = workerById(entry.worker_id);
                        const fixed = w?.worker_type === 'fijo';
                        return (
                          <div
                            key={entry.worker_id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2"
                          >
                            <span className="text-sm font-medium text-slate-800">
                              {w?.display_name || workerLabel(w || {})}
                              {fixed ? (
                                <span className="ml-2 text-xs font-normal text-slate-500">(fijo)</span>
                              ) : null}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              {!fixed ? (
                                <label className="flex items-center gap-2 text-sm">
                                  <span className="text-slate-600">Tarifa</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={entry.rate_applied}
                                    onChange={(e) => updateWorkerEntryRate(entry.worker_id, e.target.value)}
                                    disabled={saving}
                                    className="w-28 rounded border border-slate-300 px-2 py-1"
                                  />
                                </label>
                              ) : (
                                <span className="text-xs text-slate-500">Tarifa 0 (fijo)</span>
                              )}
                              <button
                                type="button"
                                onClick={() => removeWorkerEntry(entry.worker_id)}
                                disabled={saving}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                              >
                                Quitar
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Trabajador *</span>
                  <select value={form.worker_id} onChange={(e) => onChange('worker_id', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2">
                    <option value="">Selecciona trabajador</option>
                    {meta.workers.map((w) => <option key={w.id} value={w.id}>{w.display_name || workerLabel(w)}</option>)}
                  </select>
                </label>
              )}

              <label className="text-sm">
                <span className="mb-1 block font-medium">Tipo de labor *</span>
                <input
                  type="text"
                  value={laborTypeSearch}
                  onChange={(e) => onLaborTypeSearchChange(e.target.value)}
                  list="labor-types-list"
                  placeholder="Escribe para buscar tipo de labor"
                  disabled={saving}
                  className="w-full rounded border border-slate-300 px-3 py-2"
                />
                <datalist id="labor-types-list">
                  {filteredLaborTypes.map((t) => (
                    <option key={t.id} value={t.name} />
                  ))}
                </datalist>
                {!form.labor_type_id && laborTypeSearch ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Selecciona un tipo válido de la lista sugerida.
                  </p>
                ) : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Unidad *</span>
                <select value={form.unit} onChange={(e) => onChange('unit', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2">
                  {meta.units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                </select>
              </label>

              {form.is_bulk && !editingId ? null : (
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Cantidad *</span>
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={form.qty}
                    onChange={(e) => onChange('qty', e.target.value)}
                    disabled={saving || form.unit === 'jornal'}
                    className="w-full rounded border border-slate-300 px-3 py-2"
                  />
                </label>
              )}

              {!form.is_multi_worker && !isFixedWorker ? (
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Tarifa aplicada *</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.rate_applied}
                    onChange={(e) => onChange('rate_applied', e.target.value)}
                    disabled={saving}
                    className="w-full rounded border border-slate-300 px-3 py-2"
                  />
                </label>
              ) : null}

              {!editingId ? (
                <label className="inline-flex items-center gap-2 text-sm lg:col-span-3">
                  <input
                    type="checkbox"
                    checked={form.is_bulk}
                    onChange={(e) => onChange('is_bulk', e.target.checked)}
                    disabled={saving}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Carga por rango de fechas
                  {form.is_multi_worker ? ' (aplica a todos los trabajadores seleccionados)' : ''}
                </label>
              ) : (
                <div />
              )}

              {form.is_bulk && !editingId ? (
                <>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Desde *</span>
                    <input type="date" value={form.from_date} onChange={(e) => onChange('from_date', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2" />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Hasta *</span>
                    <input type="date" value={form.to_date} onChange={(e) => onChange('to_date', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2" />
                  </label>
                </>
              ) : (
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Fecha *</span>
                  <input type="date" value={form.work_date} onChange={(e) => onChange('work_date', e.target.value)} disabled={saving} className="w-full rounded border border-slate-300 px-3 py-2" />
                </label>
              )}

              {form.is_bulk && !editingId ? (
                <div className="lg:col-span-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <h5 className="mb-2 text-sm font-semibold text-slate-700">
                    Cantidad por día {form.unit === 'jornal' ? '(jornal fijo: 1 por día)' : ''}
                  </h5>
                  {bulkDates.length === 0 ? (
                    <p className="text-sm text-slate-500">Selecciona un rango válido.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {bulkDates.map((d) => (
                        <label key={d} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-sm">
                          <span>{d}</span>
                          {form.unit === 'jornal' ? (
                            <span className="font-medium">1</span>
                          ) : (
                            <input
                              type="number"
                              step="0.001"
                              min="0.001"
                              value={dailyQtyByDate[d] ?? String(form.qty || '')}
                              onChange={(e) =>
                                setDailyQtyByDate((prev) => ({ ...prev, [d]: e.target.value }))
                              }
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-right"
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              <label className="text-sm lg:col-span-3">
                <span className="mb-1 block font-medium">Notas</span>
                <textarea value={form.notes} onChange={(e) => onChange('notes', e.target.value)} disabled={saving} rows={2} className="w-full rounded border border-slate-300 px-3 py-2" />
              </label>

              {form.cost_scope === 'farm' && selectedFarmMode === 'manual' ? (
                <div className="lg:col-span-3 rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Prorrateo manual (%)</span>
                    <button type="button" onClick={ensureManualAllocationsSeed} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">Cargar lotes</button>
                  </div>
                  {form.allocations.length === 0 ? (
                    <p className="text-sm text-slate-500">Primero carga lotes de la finca seleccionada.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {form.allocations.map((a) => {
                        const lot = farmLots.find((l) => l.id === a.lot_id);
                        return (
                          <label key={a.lot_id} className="flex items-center justify-between gap-2 text-sm">
                            <span>{lot?.name || a.lot_id}</span>
                            <input type="number" step="0.001" min="0" max="100" value={a.allocation_pct} onChange={(e) => updateAllocation(a.lot_id, e.target.value)} className="w-24 rounded border border-slate-300 px-2 py-1" />
                          </label>
                        );
                      })}
                      <p className="md:col-span-2 text-xs text-slate-600">
                        Suma actual: {sumAllocations(form.allocations).toFixed(3)}%
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              {form.cost_scope === 'farm' && selectedFarmMode === 'area' && lotsWithoutArea.length > 0 ? (
                <p className="lg:col-span-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Esta finca usa asignación por área. Los lotes sin área tendrán asignación 0%:{' '}
                  {lotsWithoutArea.map((l) => l.name).join(', ')}. Si deseas cambiar esto, edita la finca y ajusta el
                  método de asignación de costos.
                </p>
              ) : null}

              {modalError ? <p className="lg:col-span-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{modalError}</p> : null}

              <div className="lg:col-span-3 flex flex-wrap items-center gap-2">
                <button type="submit" disabled={saving} className="rounded bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {editingId
                    ? 'Guardar cambios'
                    : form.is_multi_worker
                      ? `Crear ${multiCreateCount || form.worker_entries.length} registro(s)`
                      : form.is_bulk
                        ? 'Crear en bloque'
                        : 'Crear registro'}
                </button>
                <button type="button" onClick={closeModal} disabled={saving} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

