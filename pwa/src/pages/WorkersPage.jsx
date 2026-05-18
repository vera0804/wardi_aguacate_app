import { useEffect, useMemo, useState } from 'react';
import {
  createWorker,
  listWorkers,
  setWorkerActive,
  updateWorker,
} from '../services/workers.js';

const SELECTABLE_WORKER_TYPES = ['fijo', 'ocasional'];
/** Incluye recolector solo para filtrar / mostrar filas ya guardadas en BD. */
const WORKER_FILTER_TYPES = ['fijo', 'ocasional', 'recolector'];
const WORKER_TYPE_LABELS = {
  fijo: 'Fijo (salario mensual fijo)',
  ocasional: 'Ocasional (jornales, horas o por tarea)',
  recolector: 'Recolector (histórico)',
};
const ID_TYPES = ['nacional', 'extranjero'];
const PHONE_ALLOWED_REGEX = /^[0-9+\-() ]+$/;

const DEFAULT_FORM = {
  worker_type: 'fijo',
  first_name: '',
  last_name_1: '',
  last_name_2: '',
  id_type: 'nacional',
  id_number: '',
  phone: '',
  notes: '',
};

function fullName(worker) {
  return [worker.first_name, worker.last_name_1, worker.last_name_2]
    .filter(Boolean)
    .join(' ');
}

function identityLabel(worker) {
  if (!worker.id_number) return '—';
  return `${worker.id_type}: ${worker.id_number}`;
}

export default function WorkersPage({ user }) {
  const [workers, setWorkers] = useState([]);
  const [activeFilter, setActiveFilter] = useState('true');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [listError, setListError] = useState('');
  const [modalError, setModalError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const readOnly = false;

  async function refresh() {
    setLoading(true);
    setListError('');
    try {
      const data = await listWorkers({
        active: activeFilter,
        type: typeFilter || undefined,
        search: searchTerm || undefined,
      });
      setWorkers(data || []);
    } catch (e) {
      setListError(e?.message || 'No se pudieron cargar los trabajadores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      refresh();
    }, 200);
    return () => clearTimeout(t);
  }, [activeFilter, typeFilter, searchTerm]);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setModalError('');
    setShowModal(true);
  }

  function openEdit(worker) {
    setEditingId(worker.id);
    setForm({
      worker_type: worker.worker_type || 'fijo',
      first_name: worker.first_name || '',
      last_name_1: worker.last_name_1 || '',
      last_name_2: worker.last_name_2 || '',
      id_type: worker.id_type || 'nacional',
      id_number: worker.id_number || '',
      phone: worker.phone || '',
      notes: worker.notes || '',
    });
    setModalError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setModalError('');
    resetForm();
  }

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateForm() {
    const typeOk =
      SELECTABLE_WORKER_TYPES.includes(form.worker_type) ||
      (editingId && form.worker_type === 'recolector');
    if (!typeOk) {
      return 'Tipo de trabajador inválido.';
    }
    if (!String(form.first_name || '').trim()) {
      return 'El nombre es obligatorio.';
    }
    if (!ID_TYPES.includes(form.id_type)) {
      return 'Tipo de identificación inválido.';
    }
    if (form.phone && !PHONE_ALLOWED_REGEX.test(form.phone.trim())) {
      return 'El teléfono solo puede contener números y caracteres como +, -, paréntesis y espacios.';
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readOnly) return;
    const validation = validateForm();
    if (validation) {
      setModalError(validation);
      return;
    }

    const payload = {
      first_name: form.first_name.trim(),
      last_name_1: form.last_name_1.trim() || null,
      last_name_2: form.last_name_2.trim() || null,
      id_type: form.id_type,
      id_number: form.id_number.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    };
    // Crear siempre envía tipo. Editar un legado "recolector" sin cambiar tipo: no enviar worker_type (la API solo acepta fijo/ocasional).
    if (!editingId || form.worker_type !== 'recolector') {
      payload.worker_type = form.worker_type;
    }

    setSaving(true);
    setModalError('');
    try {
      if (editingId) {
        await updateWorker(editingId, payload);
      } else {
        await createWorker(payload);
      }
      closeModal();
      await refresh();
    } catch (e2) {
      setModalError(e2?.message || 'No se pudo guardar el trabajador.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(worker) {
    if (readOnly) return;
    const action = worker.is_active ? 'inactivar' : 'activar';
    const ok = window.confirm(`¿Deseas ${action} este trabajador?`);
    if (!ok) return;

    setSaving(true);
    setListError('');
    try {
      await setWorkerActive(worker.id, !worker.is_active);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo actualizar el estado del trabajador.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Trabajadores</h3>
          <p className="text-sm text-slate-600">Gestiona trabajadores por tipo, estado e identificación.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            {WORKER_FILTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {WORKER_TYPE_LABELS[t] || t}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre o identificación"
            className="w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          {!readOnly ? (
            <button
              type="button"
              onClick={openCreate}
              disabled={saving}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Crear trabajador
            </button>
          ) : null}
        </div>
      </header>

      {listError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{listError}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Identificación</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Teléfono</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Cargando trabajadores...
                </td>
              </tr>
            ) : workers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  No hay trabajadores para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              workers.map((worker) => (
                <tr key={worker.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{fullName(worker)}</td>
                  <td className="px-3 py-2">{identityLabel(worker)}</td>
                  <td className="px-3 py-2 text-sm text-slate-800">
                    {WORKER_TYPE_LABELS[worker.worker_type] || worker.worker_type}
                  </td>
                  <td className="px-3 py-2">{worker.phone || '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        worker.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {worker.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(worker)}
                        disabled={readOnly || saving}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(worker)}
                        disabled={readOnly || saving}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {worker.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-800">
                {editingId ? 'Editar trabajador' : 'Crear trabajador'}
              </h4>
              <button
                type="button"
                onClick={closeModal}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                Cerrar
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <label className="text-sm lg:col-span-2">
                <span className="mb-1 block font-medium">Tipo de trabajador *</span>
                <select
                  value={form.worker_type}
                  onChange={(e) => onChange('worker_type', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {editingId && form.worker_type === 'recolector' ? (
                    <option value="recolector">Recolector (histórico en base de datos)</option>
                  ) : null}
                  {SELECTABLE_WORKER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {WORKER_TYPE_LABELS[t] || t}
                    </option>
                  ))}
                </select>
                {form.worker_type === 'fijo' ? (
                  <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
                    <strong>Trabajador fijo</strong> es quien tiene un <strong>salario mensual fijo</strong> en nómina,
                    independientemente de los días trabajados. Si la persona cobra por <strong>jornales</strong>, por{' '}
                    <strong>horas</strong> o por <strong>tarea / rendimiento</strong>, no es fija: elija{' '}
                    <strong>Ocasional</strong>.
                  </p>
                ) : (
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    Use <strong>Ocasional</strong> cuando el pago dependa de jornales, horas o tareas. Los costos de esas
                    labores se calculan con la <strong>tarifa</strong> que registre en cada labor.
                  </p>
                )}
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Nombre *</span>
                <input
                  value={form.first_name}
                  onChange={(e) => onChange('first_name', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Primer apellido</span>
                <input
                  value={form.last_name_1}
                  onChange={(e) => onChange('last_name_1', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Segundo apellido</span>
                <input
                  value={form.last_name_2}
                  onChange={(e) => onChange('last_name_2', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Tipo de identificación *</span>
                <select
                  value={form.id_type}
                  onChange={(e) => onChange('id_type', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {ID_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Número de identificación</span>
                <input
                  value={form.id_number}
                  onChange={(e) => onChange('id_number', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="text-sm">
                <span className="mb-1 block font-medium">Teléfono</span>
                <input
                  type="tel"
                  inputMode="tel"
                  pattern="[0-9+\-() ]*"
                  value={form.phone}
                  onChange={(e) => onChange('phone', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              <label className="text-sm lg:col-span-2">
                <span className="mb-1 block font-medium">Notas</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => onChange('notes', e.target.value)}
                  disabled={saving}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>

              {modalError ? (
                <p className="lg:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {modalError}
                </p>
              ) : null}

              <div className="lg:col-span-2 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {editingId ? 'Guardar cambios' : 'Crear trabajador'}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

