import { useEffect, useMemo, useState } from 'react';
import {
  createAvocadoProduction,
  createAvocadoProductionBulk,
  getAvocadoProductionById,
  getAvocadoProductionMeta,
  getAvocadoProductionSummaryByLot,
  listAvocadoProduction,
  setAvocadoProductionActive,
  updateAvocadoProduction,
} from '../services/avocadoProduction.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateDisplay(iso) {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function buildDateRange(fromDate, toDate) {
  if (!fromDate || !toDate) return [];
  const start = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const out = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function normalizeDetails(details) {
  return (details || [])
    .map((d) => ({
      caliber_id: d.caliber_id,
      kilos: d.kilos === '' ? 0 : Number(d.kilos),
      price_per_kg: d.price_per_kg === '' ? null : Number(d.price_per_kg),
    }))
    .filter((d) => d.kilos > 0 || d.price_per_kg !== null);
}

const DEFAULT_FORM = {
  cost_scope: 'lot',
  farm_id: '',
  lot_id: '',
  prod_date: today(),
  from_date: today(),
  to_date: today(),
  is_bulk: false,
  notes: '',
  details: [],
  allocations: [],
};

export default function AvocadoProductionPage({ user }) {
  const [meta, setMeta] = useState({ farms: [], lots: [], calibers: [] });
  const [filters, setFilters] = useState({
    from_date: '',
    to_date: '',
    cost_scope: '',
    active: 'true',
    farm_id: '',
    lot_id: '',
  });
  const [rows, setRows] = useState([]);
  const [summaryLot, setSummaryLot] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [modalError, setModalError] = useState('');
  const [dailyDetailsByDate, setDailyDetailsByDate] = useState({});
  const [selectedBulkDate, setSelectedBulkDate] = useState('');

  const readOnly = false;

  const farmLots = useMemo(
    () => meta.lots.filter((l) => l.farm_id === form.farm_id),
    [meta.lots, form.farm_id]
  );

  const selectedFarm = useMemo(
    () => meta.farms.find((f) => f.id === form.farm_id) || null,
    [meta.farms, form.farm_id]
  );
  const bulkDates = useMemo(
    () => buildDateRange(form.from_date, form.to_date),
    [form.from_date, form.to_date]
  );

  useEffect(() => {
    if (!bulkDates.length) {
      setSelectedBulkDate('');
      return;
    }
    if (!selectedBulkDate || !bulkDates.includes(selectedBulkDate)) {
      setSelectedBulkDate(bulkDates[0]);
    }
  }, [bulkDates, selectedBulkDate]);

  useEffect(() => {
    (async () => {
      try {
        const data = await getAvocadoProductionMeta();
        setMeta({
          farms: data?.farms || [],
          lots: data?.lots || [],
          calibers: data?.calibers || [],
        });
      } catch (e) {
        setListError(e?.message || 'No se pudo cargar metadata de producción.');
      }
    })();
  }, []);

  async function refresh() {
    setLoading(true);
    setListError('');
    try {
      const [items, byLot] = await Promise.all([
        listAvocadoProduction(filters),
        getAvocadoProductionSummaryByLot(filters),
      ]);
      setRows(items || []);
      setSummaryLot(byLot || []);
    } catch (e) {
      setListError(e?.message || 'No se pudo cargar producción.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [filters.from_date, filters.to_date, filters.cost_scope, filters.active, filters.farm_id, filters.lot_id]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function resetForm() {
    setForm({
      ...DEFAULT_FORM,
      details: meta.calibers.map((c) => ({
        caliber_id: c.id,
        caliber_name: c.name,
        kilos: '',
        price_per_kg: '',
        is_active: true,
      })),
    });
    setEditingId(null);
    setDailyDetailsByDate({});
    setSelectedBulkDate('');
  }

  function openCreate() {
    resetForm();
    setModalError('');
    setShowModal(true);
  }

  async function openEdit(row) {
    try {
      const full = await getAvocadoProductionById(row.id);
      const derivedFarmId = full.farm_id || meta.lots.find((l) => l.id === full.lot_id)?.farm_id || '';
      const detailsByCaliber = new Map((full.details || []).map((d) => [d.caliber_id, d]));
      const historicalDetails = (full.details || []).map((d) => ({
        caliber_id: d.caliber_id,
        caliber_name: d.caliber_name,
        kilos: d.kilos ?? '',
        price_per_kg: d.price_per_kg ?? '',
        is_active: meta.calibers.some((c) => c.id === d.caliber_id),
      }));
      const activeMissingDetails = meta.calibers
        .filter((c) => !detailsByCaliber.has(c.id))
        .map((c) => ({
          caliber_id: c.id,
          caliber_name: c.name,
          kilos: '',
          price_per_kg: '',
          is_active: true,
        }));
      setEditingId(full.id);
      setForm({
        ...DEFAULT_FORM,
        cost_scope: full.cost_scope,
        farm_id: derivedFarmId,
        lot_id: full.lot_id || '',
        prod_date: String(full.prod_date).slice(0, 10),
        notes: full.notes || '',
        details: [...historicalDetails, ...activeMissingDetails],
        allocations: (full.allocations || []).map((a) => ({
          lot_id: a.lot_id,
          allocation_pct: String(a.allocation_pct),
        })),
      });
      setModalError('');
      setShowModal(true);
    } catch (e) {
      setListError(e?.message || 'No se pudo cargar el detalle para edición.');
    }
  }

  async function openView(row) {
    try {
      const full = await getAvocadoProductionById(row.id);
      setDetailRow(full);
      setShowDetailModal(true);
    } catch (e) {
      setListError(e?.message || 'No se pudo cargar el detalle.');
    }
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
      return next;
    });
    if (field === 'from_date' || field === 'to_date') {
      setDailyDetailsByDate({});
    }
  }

  function setDetail(caliberId, field, value) {
    setForm((prev) => ({
      ...prev,
      details: prev.details.map((d) => (d.caliber_id === caliberId ? { ...d, [field]: value } : d)),
    }));
  }

  function seedManualAllocations() {
    if (!form.farm_id) return;
    if (form.allocations.length) return;
    setForm((prev) => ({
      ...prev,
      allocations: farmLots.map((l) => ({ lot_id: l.id, allocation_pct: '0' })),
    }));
  }

  function setAllocation(lotId, value) {
    setForm((prev) => ({
      ...prev,
      allocations: prev.allocations.map((a) => (a.lot_id === lotId ? { ...a, allocation_pct: value } : a)),
    }));
  }

  function validateForm() {
    if (form.cost_scope === 'lot' && !form.lot_id) return 'Debes seleccionar lote.';
    if (form.cost_scope === 'farm' && !form.farm_id) return 'Debes seleccionar finca.';
    if (!form.is_bulk && !form.prod_date) return 'Debes seleccionar fecha.';
    if (form.is_bulk && (!form.from_date || !form.to_date)) return 'Debes seleccionar rango de fechas.';
    if (form.is_bulk) {
      if (!bulkDates.length) return 'Rango de fechas inválido.';
      for (const day of bulkDates) {
        const normalized = normalizeDetails(dailyDetailsByDate[day] || form.details);
        if (!normalized.length) return `Ingresa al menos un calibre con kilos o precio para ${day}.`;
        for (const d of normalized) {
          if (!Number.isFinite(d.kilos) || d.kilos < 0) return `Kilos inválidos en ${day}.`;
          if (d.price_per_kg !== null && (!Number.isFinite(d.price_per_kg) || d.price_per_kg < 0)) {
            return `Precio por kilo inválido en ${day}.`;
          }
        }
      }
    } else {
      const details = normalizeDetails(form.details);
      if (!details.length) return 'Ingresa al menos un calibre con kilos o precio.';
      for (const d of details) {
        if (!Number.isFinite(d.kilos) || d.kilos < 0) return 'Los kilos deben ser mayor o igual a 0.';
        if (d.price_per_kg !== null && (!Number.isFinite(d.price_per_kg) || d.price_per_kg < 0)) {
          return 'El precio por kilo debe ser mayor o igual a 0.';
        }
      }
    }
    if (form.cost_scope === 'farm' && selectedFarm?.labor_allocation_mode === 'manual') {
      const total = form.allocations.reduce((acc, a) => acc + Number(a.allocation_pct || 0), 0);
      if (Math.abs(total - 100) > 0.01) return 'En modo manual, las asignaciones deben sumar 100%.';
    }
    return null;
  }

  function buildPayload() {
    const details = normalizeDetails(form.details);
    const payload = {
      cost_scope: form.cost_scope,
      farm_id: form.cost_scope === 'farm' ? form.farm_id : null,
      lot_id: form.cost_scope === 'lot' ? form.lot_id : null,
      notes: form.notes || null,
      details,
    };
    if (form.cost_scope === 'farm' && selectedFarm?.labor_allocation_mode === 'manual') {
      payload.allocations = form.allocations.map((a) => ({
        lot_id: a.lot_id,
        allocation_pct: Number(a.allocation_pct || 0),
      }));
    }
    if (form.is_bulk) {
      payload.from_date = form.from_date;
      payload.to_date = form.to_date;
      payload.daily_items = bulkDates.map((day) => ({
        prod_date: day,
        details: normalizeDetails(dailyDetailsByDate[day] || form.details),
      }));
    } else {
      payload.prod_date = form.prod_date;
    }
    return payload;
  }

  function setDailyDetail(day, caliberId, field, value) {
    setDailyDetailsByDate((prev) => {
      const current = prev[day] || form.details;
      return {
        ...prev,
        [day]: current.map((d) => (d.caliber_id === caliberId ? { ...d, [field]: value } : d)),
      };
    });
  }

  function copyFirstDayToAll() {
    if (!bulkDates.length) return;
    const source = dailyDetailsByDate[bulkDates[0]] || form.details;
    const next = {};
    bulkDates.forEach((d) => {
      next[d] = source.map((x) => ({ ...x }));
    });
    setDailyDetailsByDate(next);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readOnly) return;
    const validation = validateForm();
    if (validation) {
      setModalError(validation);
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const payload = buildPayload();
      if (editingId) {
        await updateAvocadoProduction(editingId, payload);
      } else if (form.is_bulk) {
        await createAvocadoProductionBulk(payload);
      } else {
        await createAvocadoProduction(payload);
      }
      closeModal();
      await refresh();
    } catch (e2) {
      setModalError(e2?.message || 'No se pudo guardar la producción.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row) {
    if (readOnly) return;
    setSaving(true);
    setListError('');
    try {
      await setAvocadoProductionActive(row.id, !row.is_active);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo cambiar el estado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Producción de aguacate</h3>
          <p className="text-sm text-slate-600">
            Registra producción por lote o por finca, en fecha única o rango de fechas.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowSummary((v) => !v)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            {showSummary ? 'Ocultar resumen' : 'Ver resumen'}
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white"
            >
              Registrar producción
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-6">
        <input type="date" value={filters.from_date} onChange={(e) => setFilter('from_date', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input type="date" value={filters.to_date} onChange={(e) => setFilter('to_date', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={filters.cost_scope} onChange={(e) => setFilter('cost_scope', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Asignar por: todos</option>
          <option value="lot">Lote</option>
          <option value="farm">Finca</option>
        </select>
        <select value={filters.active} onChange={(e) => setFilter('active', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select value={filters.farm_id} onChange={(e) => setFilter('farm_id', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Finca: todas</option>
          {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select value={filters.lot_id} onChange={(e) => setFilter('lot_id', e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Lote: todos</option>
          {meta.lots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {listError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{listError}</p> : null}

      {showSummary ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h4 className="mb-2 text-sm font-semibold">Resumen por lote</h4>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr><th className="px-2 py-1.5">Lote</th><th className="px-2 py-1.5">Kilos</th><th className="px-2 py-1.5">Monto</th></tr>
              </thead>
              <tbody>
                {summaryLot.map((s) => (
                  <tr key={s.lot_id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{s.lot_name || '—'}</td>
                    <td className="px-2 py-1.5">{Number(s.total_kilos || 0).toFixed(2)}</td>
                    <td className="px-2 py-1.5">{Number(s.total_amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Asignar por</th>
              <th className="px-3 py-2">Finca/Lote</th>
              <th className="px-3 py-2">Kilos totales</th>
              <th className="px-3 py-2">Monto</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="px-3 py-3 text-center text-slate-500">Cargando...</td></tr> : null}
            {!loading && rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-3 text-center text-slate-500">Sin registros.</td></tr> : null}
            {!loading ? rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{String(r.prod_date).slice(0, 10)}</td>
                <td className="px-3 py-2">{r.cost_scope === 'farm' ? 'Finca' : 'Lote'}</td>
                <td className="px-3 py-2">{r.cost_scope === 'farm' ? r.farm_name : r.lot_name}</td>
                <td className="px-3 py-2">{Number(r.total_kilos || 0).toFixed(2)}</td>
                <td className="px-3 py-2">{Number(r.total_amount || 0).toFixed(2)}</td>
                <td className="px-3 py-2">{r.is_active ? 'Activo' : 'Inactivo'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => openView(r)} className="rounded border border-slate-300 px-2 py-1 text-xs">Ver</button>
                    <button type="button" onClick={() => openEdit(r)} disabled={saving} className="rounded border border-slate-300 px-2 py-1 text-xs">Editar</button>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => handleToggleActive(r)}
                        disabled={saving}
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          r.is_active
                            ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        }`}
                      >
                        {r.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )) : null}
          </tbody>
        </table>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[95vh] w-full max-w-4xl overflow-auto rounded-xl bg-white p-4 text-slate-800 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold">{editingId ? 'Editar producción' : 'Registrar producción'}</h4>
              <button type="button" onClick={closeModal} className="rounded border border-slate-300 px-2 py-1 text-xs">Cerrar</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block">Asignar por *</span>
                  <select value={form.cost_scope} onChange={(e) => onChange('cost_scope', e.target.value)} disabled={!!editingId} className="w-full rounded border border-slate-300 px-2 py-2">
                    <option value="lot">Lote</option>
                    <option value="farm">Finca</option>
                  </select>
                </label>
                {form.cost_scope === 'lot' ? (
                  <>
                    <label className="text-sm">
                      <span className="mb-1 block">Finca *</span>
                      <select value={form.farm_id} onChange={(e) => onChange('farm_id', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-2">
                        <option value="">Selecciona</option>
                        {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block">Lote *</span>
                      <select value={form.lot_id} onChange={(e) => onChange('lot_id', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-2">
                        <option value="">Selecciona</option>
                        {farmLots.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <label className="text-sm">
                    <span className="mb-1 block">Finca *</span>
                    <select value={form.farm_id} onChange={(e) => onChange('farm_id', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-2">
                      <option value="">Selecciona</option>
                      {meta.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                )}
              </div>

              {!editingId ? (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.is_bulk} onChange={(e) => onChange('is_bulk', e.target.checked)} />
                  Carga por rango de fechas
                </label>
              ) : null}

              {form.is_bulk && !editingId ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <input type="date" value={form.from_date} onChange={(e) => onChange('from_date', e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
                  <input type="date" value={form.to_date} onChange={(e) => onChange('to_date', e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
                </div>
              ) : (
                <input type="date" value={form.prod_date} onChange={(e) => onChange('prod_date', e.target.value)} className="rounded border border-slate-300 px-2 py-2" />
              )}

              <div className="rounded-lg border border-slate-200 p-3">
                <h5 className="mb-2 text-sm font-semibold">Calibres (kilos y precio por kg)</h5>
                {form.is_bulk && !editingId ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-600">
                        Define kilos y precio por cada día. Selecciona una fecha para capturar sus valores.
                      </p>
                      <button
                        type="button"
                        onClick={copyFirstDayToAll}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        Copiar primer día a todos
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {bulkDates.map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setSelectedBulkDate(day)}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                            selectedBulkDate === day
                              ? 'border-lime-600 bg-lime-600 text-white'
                              : 'border-slate-300 bg-white text-slate-700'
                          }`}
                        >
                          {formatDateDisplay(day)}
                        </button>
                      ))}
                    </div>
                    <div className="max-h-80 overflow-auto rounded border border-slate-200 p-2">
                      <p className="mb-2 text-xs font-semibold text-slate-700">
                        Capturando: {formatDateDisplay(selectedBulkDate)}
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        {(dailyDetailsByDate[selectedBulkDate] || form.details).map((d) => (
                          <div
                            key={`${selectedBulkDate}-${d.caliber_id}`}
                            className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_130px_150px]"
                          >
                            <div className="rounded border border-slate-300 bg-slate-50 px-2 py-2 text-sm">
                              {d.caliber_name}
                              {d.is_active === false ? (
                                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                                  Inactivo
                                </span>
                              ) : null}
                            </div>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={d.kilos}
                              onChange={(e) =>
                                setDailyDetail(selectedBulkDate, d.caliber_id, 'kilos', e.target.value)
                              }
                              placeholder="Kilos"
                              disabled={d.is_active === false}
                              className="rounded border border-slate-300 px-2 py-2 text-sm"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={d.price_per_kg}
                              onChange={(e) =>
                                setDailyDetail(selectedBulkDate, d.caliber_id, 'price_per_kg', e.target.value)
                              }
                              placeholder="Precio/kg"
                              disabled={d.is_active === false}
                              className="rounded border border-slate-300 px-2 py-2 text-sm"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {form.details.map((d) => (
                      <div key={d.caliber_id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_160px]">
                        <div className="rounded border border-slate-300 bg-slate-50 px-2 py-2 text-sm">
                          {d.caliber_name}
                          {d.is_active === false ? (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                              Inactivo
                            </span>
                          ) : null}
                        </div>
                        <input type="number" min="0" step="0.01" value={d.kilos} onChange={(e) => setDetail(d.caliber_id, 'kilos', e.target.value)} placeholder="Kilos" disabled={d.is_active === false} className="rounded border border-slate-300 px-2 py-2 text-sm" />
                        <input type="number" min="0" step="0.01" value={d.price_per_kg} onChange={(e) => setDetail(d.caliber_id, 'price_per_kg', e.target.value)} placeholder="Precio/kg (opcional)" disabled={d.is_active === false} className="rounded border border-slate-300 px-2 py-2 text-sm" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {form.cost_scope === 'farm' && selectedFarm?.labor_allocation_mode === 'manual' ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm text-amber-900">Asignaciones manuales por lote (debe sumar 100%).</p>
                    <button type="button" onClick={seedManualAllocations} className="rounded border border-amber-300 bg-white px-2 py-1 text-xs">
                      Cargar lotes
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {form.allocations.map((a) => (
                      <div key={a.lot_id} className="grid grid-cols-[1fr_140px] gap-2">
                        <div className="rounded border border-slate-300 bg-white px-2 py-2 text-sm">
                          {farmLots.find((l) => l.id === a.lot_id)?.name || a.lot_id}
                        </div>
                        <input type="number" min="0" max="100" step="0.001" value={a.allocation_pct} onChange={(e) => setAllocation(a.lot_id, e.target.value)} className="rounded border border-slate-300 px-2 py-2 text-sm" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="text-sm block">
                <span className="mb-1 block">Notas</span>
                <textarea rows={2} value={form.notes} onChange={(e) => onChange('notes', e.target.value)} className="w-full rounded border border-slate-300 px-2 py-2" />
              </label>

              {modalError ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{modalError}</p> : null}

              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Registrar'}
                </button>
                <button type="button" onClick={closeModal} className="rounded border border-slate-300 px-4 py-2 text-sm">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showDetailModal && detailRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-4 text-slate-800 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold">Detalle de producción</h4>
              <button
                type="button"
                onClick={() => {
                  setShowDetailModal(false);
                  setDetailRow(null);
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs"
              >
                Cerrar
              </button>
            </div>
            <p className="mb-2 text-sm text-slate-600">
              Fecha: <span className="font-semibold">{String(detailRow.prod_date).slice(0, 10)}</span> ·{' '}
              {detailRow.cost_scope === 'farm' ? `Finca: ${detailRow.farm_name}` : `Lote: ${detailRow.lot_name}`}
            </p>
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="px-3 py-2">Calibre</th>
                    <th className="px-3 py-2">Kilos</th>
                    <th className="px-3 py-2">Precio unitario</th>
                    <th className="px-3 py-2">Precio total</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailRow.details || []).map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{d.caliber_name}</td>
                      <td className="px-3 py-2">{Number(d.kilos || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {d.price_per_kg == null ? '—' : Number(d.price_per_kg).toFixed(2)}
                      </td>
                      <td className="px-3 py-2">{Number(d.total_amount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

