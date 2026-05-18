import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLaborEntriesMeta } from '../services/laborEntries.js';
import {
  listCalendarActivities,
  createCalendarActivity,
  updateCalendarActivity,
} from '../services/calendarActivities.js';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const STATUS_FILTER = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Solo pendientes' },
  { value: 'completed', label: 'Solo realizadas' },
  { value: 'cancelled', label: 'Solo canceladas' },
  { value: 'pending_completed', label: 'Pendientes y realizadas' },
];

function localYmd(d) {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthRangeIso(year, month1to12) {
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${year}-${pad(month1to12)}-01`;
  const last = new Date(year, month1to12, 0).getDate();
  const to = `${year}-${pad(month1to12)}-${pad(last)}`;
  return { from, to };
}

function buildMonthCells(year, month1to12) {
  const first = new Date(year, month1to12 - 1, 1);
  const startDow = first.getDay();
  const mondayOffset = (startDow + 6) % 7;
  const cursor = new Date(first);
  cursor.setDate(cursor.getDate() - mondayOffset);
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const inMonth = cursor.getMonth() === month1to12 - 1 && cursor.getFullYear() === year;
    cells.push({ date: new Date(cursor), ymd: localYmd(cursor), inMonth });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

/** Misma convención que otras pantallas: día civil desde ISO del API. */
function activityDayKey(iso) {
  if (iso == null || iso === '') return '';
  const s = String(iso).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return s;
}

function statusCardClasses(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed')
    return 'border-emerald-400 bg-emerald-50 text-emerald-950 hover:border-emerald-500';
  if (s === 'cancelled') return 'border-rose-400 bg-rose-50 text-rose-950 hover:border-rose-500';
  return 'border-amber-400 bg-amber-50 text-amber-950 hover:border-amber-500';
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-3.5 w-3.5 rounded bg-emerald-500" aria-hidden />
        Realizada
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-3.5 w-3.5 rounded bg-rose-500" aria-hidden />
        Cancelada
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-3.5 w-3.5 rounded bg-amber-400" aria-hidden />
        Pendiente
      </span>
    </div>
  );
}

const emptyForm = {
  activity_date: '',
  lot_id: '',
  labor_type_id: '',
  notes: '',
};

export default function Cronograma({ user }) {
  const readOnly = false;

  const todayStr = useMemo(() => localYmd(new Date()), []);

  const [meta, setMeta] = useState({ farms: [], lots: [], laborTypes: [] });
  const [farmId, setFarmId] = useState('');
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [statusFilter, setStatusFilter] = useState('pending_completed');
  const [rawActivities, setRawActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [createError, setCreateError] = useState('');

  const [editRow, setEditRow] = useState(null);
  const [editForm, setEditForm] = useState({ status: '', notes: '' });
  const [editError, setEditError] = useState('');

  const { from, to } = useMemo(() => monthRangeIso(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const cells = useMemo(() => buildMonthCells(cursor.year, cursor.month), [cursor.year, cursor.month]);

  const farmLots = useMemo(
    () => (meta.lots || []).filter((l) => !farmId || l.farm_id === farmId),
    [meta.lots, farmId]
  );

  const filteredActivities = useMemo(() => {
    let list = rawActivities;
    if (statusFilter === 'pending') list = list.filter((a) => a.status === 'pending');
    else if (statusFilter === 'completed') list = list.filter((a) => a.status === 'completed');
    else if (statusFilter === 'cancelled') list = list.filter((a) => a.status === 'cancelled');
    else if (statusFilter === 'pending_completed')
      list = list.filter((a) => a.status === 'pending' || a.status === 'completed');
    return list;
  }, [rawActivities, statusFilter]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const a of filteredActivities) {
      const k = activityDayKey(a.activity_date);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(a);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) => {
        const ln = (a.lot_name || '').localeCompare(b.lot_name || '', 'es');
        if (ln !== 0) return ln;
        return (a.labor_type_name || '').localeCompare(b.labor_type_name || '', 'es');
      });
    }
    return m;
  }, [filteredActivities]);

  useEffect(() => {
    (async () => {
      try {
        const laborMeta = await getLaborEntriesMeta();
        setMeta({
          farms: laborMeta?.farms || [],
          lots: laborMeta?.lots || [],
          laborTypes: laborMeta?.laborTypes || [],
        });
      } catch (e) {
        setError(e?.message || 'No se pudieron cargar catálogos.');
      }
    })();
  }, []);

  const loadActivities = useCallback(async () => {
    if (!farmId) {
      setRawActivities([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await listCalendarActivities({ farm_id: farmId, from, to });
      setRawActivities(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar las actividades.');
      setRawActivities([]);
    } finally {
      setLoading(false);
    }
  }, [farmId, from, to]);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  function prevMonth() {
    setCursor((c) => {
      let { year, month } = c;
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      return { year, month };
    });
  }

  function nextMonth() {
    setCursor((c) => {
      let { year, month } = c;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      return { year, month };
    });
  }

  function openCreate(ymd) {
    setCreateError('');
    setCreateForm({
      ...emptyForm,
      activity_date: ymd,
      lot_id: '',
      labor_type_id: '',
      notes: '',
    });
    setCreateOpen(true);
  }

  async function submitCreate(e) {
    e.preventDefault();
    setCreateError('');
    if (!farmId) {
      setCreateError('Elegí una finca.');
      return;
    }
    if (!createForm.labor_type_id) {
      setCreateError('El tipo de labor es obligatorio.');
      return;
    }
    try {
      await createCalendarActivity({
        farm_id: farmId,
        activity_date: createForm.activity_date,
        lot_id: createForm.lot_id || undefined,
        labor_type_id: createForm.labor_type_id,
        notes: createForm.notes || undefined,
      });
      setSuccess('Actividad creada.');
      setCreateOpen(false);
      await loadActivities();
    } catch (err) {
      setCreateError(err?.message || 'No se pudo crear.');
    }
  }

  function openEdit(row) {
    setEditError('');
    setEditRow(row);
    setEditForm({
      status: row.status || 'pending',
      notes: row.notes || '',
    });
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editRow) return;
    setEditError('');
    try {
      await updateCalendarActivity(editRow.id, {
        status: editForm.status,
        notes: editForm.notes || null,
      });
      setSuccess('Actividad actualizada.');
      setEditRow(null);
      await loadActivities();
    } catch (err) {
      setEditError(err?.message || 'No se pudo guardar.');
    }
  }

  const monthTitle = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString('es-CR', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-auto max-w-6xl text-slate-800">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-lime-800">Cronograma</h2>
          <p className="text-sm text-slate-600">
            Planificación por finca: qué labor corresponde a cada día, estado y notas.
          </p>
        </div>
        <Legend />
      </header>

      {error ? (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
      ) : null}
      {success ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}{' '}
          <button type="button" className="underline" onClick={() => setSuccess('')}>
            Cerrar
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col flex-wrap gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-end">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Finca</span>
          <select
            value={farmId}
            onChange={(e) => setFarmId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">— Elegir finca —</option>
            {(meta.farms || []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
          </select>
        </label>

        <label className="flex min-w-[220px] flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Mostrar por estado</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            {STATUS_FILTER.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={prevMonth}
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
          >
            ← Mes anterior
          </button>
          <span className="min-w-[10rem] text-center text-sm font-semibold capitalize text-slate-800">{monthTitle}</span>
          <button
            type="button"
            onClick={nextMonth}
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
          >
            Mes siguiente →
          </button>
        </div>
      </div>

      {!farmId ? (
        <p className="text-sm text-slate-600">Seleccioná una finca para ver el calendario.</p>
      ) : loading ? (
        <p className="text-sm text-slate-600">Cargando…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-center text-xs text-slate-600 md:hidden">
            Deslizá hacia los lados para ver todos los días con más detalle
          </p>
          <div
            className="overflow-x-auto overscroll-x-contain scroll-smooth [-webkit-overflow-scrolling:touch] md:overflow-x-visible"
            role="region"
            aria-label="Calendario del mes, desplazamiento horizontal en pantallas pequeñas"
          >
            <div className="grid min-w-[56rem] grid-cols-7 gap-px bg-slate-200 p-px md:min-w-0">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="bg-slate-100 px-3 py-2.5 text-center text-sm font-semibold text-slate-600"
              >
                {d}
              </div>
            ))}
            {cells.map((cell) => {
              const items = byDay.get(cell.ymd) || [];
              const isToday = cell.ymd === todayStr;
              return (
                <div
                  key={cell.ymd}
                  className={`flex min-h-[128px] min-w-[8rem] flex-col bg-white p-2 md:min-w-0 ${
                    !cell.inMonth ? 'opacity-45' : ''
                  } ${isToday ? 'ring-2 ring-lime-500 ring-inset' : ''}`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        isToday ? 'text-lime-700' : 'text-slate-700'
                      }`}
                    >
                      {Number(cell.ymd.slice(8, 10))}
                    </span>
                    {readOnly || !cell.inMonth ? null : (
                      <button
                        type="button"
                        title="Nueva actividad"
                        onClick={() => openCreate(cell.ymd)}
                        className="shrink-0 rounded border border-lime-300 px-1.5 py-0.5 text-xs text-lime-800 hover:bg-lime-50"
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
                    {items.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => openEdit(a)}
                        className={`rounded border px-2 py-1.5 text-left text-xs leading-snug shadow-sm ${statusCardClasses(a.status)}`}
                      >
                        <div className="font-semibold">{a.labor_type_name || '—'}</div>
                        <div className="mt-0.5 text-[11px] opacity-90">{a.lot_name ? a.lot_name : 'Sin lote'}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800">Nueva actividad</h3>
            <form className="mt-4 space-y-3" onSubmit={submitCreate}>
              {createError ? <p className="text-sm text-rose-600">{createError}</p> : null}
              <label className="flex flex-col gap-1 text-sm">
                <span>Fecha</span>
                <input
                  type="date"
                  required
                  value={createForm.activity_date}
                  onChange={(e) => setCreateForm((f) => ({ ...f, activity_date: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Lote (opcional)</span>
                <select
                  value={createForm.lot_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, lot_id: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">Sin lote</option>
                  {farmLots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Tipo de labor</span>
                <select
                  required
                  value={createForm.labor_type_id}
                  onChange={(e) => setCreateForm((f) => ({ ...f, labor_type_id: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="">— Elegir —</option>
                  {(meta.laborTypes || []).map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span>Notas</span>
                <textarea
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button type="submit" className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-800">Actividad</h3>
            <p className="mt-1 text-xs text-slate-600">
              {editRow.labor_type_name} · {editRow.lot_name || 'Sin lote'} · {activityDayKey(editRow.activity_date)}
            </p>
            {readOnly ? (
              <>
                <p className="mt-4 text-sm text-slate-600">Tu rol solo permite consulta.</p>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setEditRow(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                  >
                    Cerrar
                  </button>
                </div>
              </>
            ) : (
              <form className="mt-4 space-y-3" onSubmit={submitEdit}>
                {editError ? <p className="text-sm text-rose-600">{editError}</p> : null}
                <label className="flex flex-col gap-1 text-sm">
                  <span>Estado</span>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="pending">Pendiente</option>
                    <option value="completed">Realizada</option>
                    <option value="cancelled">Cancelada</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Notas</span>
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={4}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditRow(null)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
