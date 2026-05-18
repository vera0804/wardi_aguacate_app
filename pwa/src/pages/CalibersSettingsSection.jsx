import { useEffect, useMemo, useState } from 'react';
import {
  createCaliber,
  listCalibers,
  setCaliberActive,
  updateCaliber,
} from '../services/calibers.js';

const DEFAULT_FORM = {
  name: '',
  description: '',
};

export default function CalibersSettingsSection({ user }) {
  const [calibers, setCalibers] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);

  const readOnly = false;

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const rows = await listCalibers({
        includeInactive,
        search: searchTerm.trim(),
      });
      setCalibers(rows || []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar los calibres.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  useEffect(() => {
    const t = setTimeout(() => refresh(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateForm() {
    if (!String(form.name || '').trim()) return 'El nombre del calibre es obligatorio.';
    if (String(form.name || '').trim().length > 50) return 'El nombre no puede superar 50 caracteres.';
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readOnly) return;

    const validation = validateForm();
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
      };
      if (editingId) {
        await updateCaliber(editingId, payload);
      } else {
        await createCaliber(payload);
      }
      resetForm();
      await refresh();
    } catch (e2) {
      setError(e2?.message || 'No se pudo guardar el calibre.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row) {
    if (readOnly) return;
    setSaving(true);
    setError('');
    try {
      await setCaliberActive(row.id, !row.is_active);
      await refresh();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar el estado del calibre.');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row) {
    setEditingId(row.id);
    setShowForm(true);
    setForm({
      name: row.name || '',
      description: row.description || '',
    });
  }

  return (
    <section className="mt-5 space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Definir calibres del aguacate</h3>
          <p className="text-sm text-slate-600">
            Crea, edita y administra los calibres disponibles para producción.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Incluir inactivos
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nombre o descripción"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-80"
          />
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly ? (
          <button
            type="button"
            onClick={() => {
              if (!showForm) {
                setEditingId(null);
                setForm(DEFAULT_FORM);
              }
              setShowForm((v) => !v);
            }}
            disabled={saving}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {showForm ? 'Ocultar formulario' : 'Crear calibre'}
          </button>
        ) : (
          <p className="text-sm text-slate-600">Tu rol tiene acceso de solo lectura.</p>
        )}
      </div>

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-2"
        >
          <label className="text-sm">
            <span className="mb-1 block font-medium">Nombre *</span>
            <input
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              disabled={readOnly || saving}
              maxLength={50}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block font-medium">Descripción</span>
            <textarea
              value={form.description}
              onChange={(e) => onChange('description', e.target.value)}
              disabled={readOnly || saving}
              rows={3}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          <div className="flex items-center gap-2 lg:col-span-2">
            <button
              type="submit"
              disabled={saving || readOnly}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear calibre'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              <th className="px-3 py-2 font-semibold">Nombre</th>
              <th className="px-3 py-2 font-semibold">Descripción</th>
              <th className="px-3 py-2 font-semibold">Estado</th>
              <th className="px-3 py-2 font-semibold text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            ) : calibers.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                  No hay calibres para mostrar.
                </td>
              </tr>
            ) : (
              calibers.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2 text-slate-600">{row.description || '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {row.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        disabled={readOnly || saving}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-60"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(row)}
                        disabled={readOnly || saving}
                        className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      >
                        {row.is_active ? 'Inactivar' : 'Activar'}
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

