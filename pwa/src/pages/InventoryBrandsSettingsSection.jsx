import { useEffect, useState } from 'react';
import {
  createInventoryBrand,
  listInventoryBrands,
  setInventoryBrandActive,
  updateInventoryBrand,
} from '../services/inventoryBrands.js';

const DEFAULT_FORM = { name: '' };

export default function InventoryBrandsSettingsSection({ user }) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ active: 'all', search: '' });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const readOnly = false;

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await listInventoryBrands(filters);
      setRows(data || []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar las marcas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [filters.active, filters.search, user?.clientId]);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readOnly) return;
    if (!String(form.name || '').trim()) {
      setError('El nombre de la marca es obligatorio.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await updateInventoryBrand(editingId, { name: form.name.trim() });
      } else {
        await createInventoryBrand({ name: form.name.trim() });
      }
      resetForm();
      await refresh();
    } catch (e2) {
      setError(e2?.message || 'No se pudo guardar la marca.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    if (readOnly) return;
    setSaving(true);
    setError('');
    try {
      await setInventoryBrandActive(row.id, !row.is_active);
      await refresh();
    } catch (e) {
      setError(e?.message || 'No se pudo cambiar estado de la marca.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Marcas de fabricantes</h3>
          <p className="text-sm text-slate-600">
            Gestiona marcas para seleccionar o autocompletar en insumos.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <select
            value={filters.active}
            onChange={(e) => setFilters((p) => ({ ...p, active: e.target.value }))}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
          <input
            value={filters.search}
            onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
            placeholder="Buscar por nombre"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm sm:w-72"
          />
        </div>
      </header>

      {error ? <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

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
          className="rounded bg-lime-700 px-4 py-2 text-sm font-semibold text-white"
        >
          {showForm ? 'Ocultar formulario' : 'Crear marca'}
        </button>
      ) : null}

      {showForm ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[1fr_auto]">
          <input
            value={form.name}
            onChange={(e) => setForm({ name: e.target.value })}
            placeholder="Nombre de la marca"
            className="rounded border border-slate-300 px-2 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear marca'}
            </button>
            <button type="button" onClick={resetForm} className="rounded border border-slate-300 px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">Cargando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-slate-500">No hay marcas.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">{row.is_active ? 'Activa' : 'Inactiva'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setForm({ name: row.name || '' });
                        setShowForm(true);
                      }}
                      disabled={saving || readOnly}
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60"
                    >
                      Editar
                    </button>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => toggleActive(row)}
                        disabled={saving}
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          row.is_active
                            ? 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        }`}
                      >
                        {row.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

