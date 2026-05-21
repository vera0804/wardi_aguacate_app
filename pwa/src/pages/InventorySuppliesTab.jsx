import { useEffect, useMemo, useState } from 'react';
import {
  createInventoryItem,
  getInventoryItemsMeta,
  listInventoryItems,
  setInventoryItemActive,
  updateInventoryItem,
} from '../services/inventoryItems.js';
import InventoryBrandCombo from './InventoryBrandCombo.jsx';
import {
  MEASURE_TYPE_OPTIONS,
  measureTypeHint,
  measureTypeLabel,
  measureTypeToUnit,
  unitToMeasureType,
} from '../lib/inventoryMeasureType.js';

const DEFAULT_FORM = {
  name: '',
  measure_type: 'unidad',
  category_id: '',
  brand_id: '',
  brand_name: '',
};

export default function InventorySuppliesTab({ user }) {
  const [meta, setMeta] = useState({ categories: [], brands: [], units: ['kg', 'litro', 'unidad'] });
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    active: 'true',
    category_id: '',
    search: '',
  });
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const readOnly = false;

  useEffect(() => {
    (async () => {
      try {
        const data = await getInventoryItemsMeta();
        setMeta({
          categories: data?.categories || [],
          brands: data?.brands || [],
          units: data?.units || ['kg', 'litro', 'unidad'],
        });
      } catch (e) {
        setError(e?.message || 'No se pudo cargar metadata de insumos.');
      }
    })();
  }, [user?.clientId]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await listInventoryItems(filters);
      setRows(data || []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar los insumos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [filters.active, filters.category_id, filters.search, user?.clientId]);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
  }

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateForm() {
    if (!String(form.name || '').trim()) return 'El nombre es obligatorio.';
    if (!String(form.category_id || '').trim()) return 'La categoría es obligatoria.';
    if (!measureTypeToUnit(form.measure_type)) {
      return 'Selecciona un tipo de medida válido (Masa, Volumen o Unidad).';
    }
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
    const payload = {
      name: form.name.trim(),
      unit: measureTypeToUnit(form.measure_type),
      category_id: form.category_id,
      brand_id: form.brand_id || null,
      brand_name: form.brand_id ? null : form.brand_name.trim() || null,
    };
    try {
      if (editingId) {
        await updateInventoryItem(editingId, payload);
      } else {
        await createInventoryItem(payload);
      }
      resetForm();
      await refresh();
      const data = await getInventoryItemsMeta();
      setMeta({
        categories: data?.categories || [],
        brands: data?.brands || [],
        units: data?.units || ['kg', 'litro', 'unidad'],
      });
    } catch (e2) {
      setError(e2?.message || 'No se pudo guardar el insumo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(row) {
    if (readOnly) return;
    setSaving(true);
    setError('');
    try {
      await setInventoryItemActive(row.id, !row.is_active);
      await refresh();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar estado del insumo.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row) {
    setEditingId(row.id);
    setShowForm(true);
    setForm({
      name: row.name || '',
      measure_type: unitToMeasureType(row.unit),
      category_id: row.category_id || '',
      brand_id: row.brand_id || '',
      brand_name: row.brand_name || '',
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
        <select
          value={filters.active}
          onChange={(e) => setFilters((p) => ({ ...p, active: e.target.value }))}
          className="rounded border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <select
          value={filters.category_id}
          onChange={(e) => setFilters((p) => ({ ...p, category_id: e.target.value }))}
          className="rounded border border-slate-300 px-2 py-2 text-sm"
        >
          <option value="">Categoría: todas</option>
          {meta.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={filters.search}
          onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
          placeholder="Buscar por nombre, tipo de medida, categoría o fabricante"
          className="rounded border border-slate-300 px-2 py-2 text-sm lg:col-span-2"
        />
      </div>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <button
          type="button"
          onClick={() => {
            if (!showForm) {
              setForm(DEFAULT_FORM);
              setEditingId(null);
            }
            setShowForm((v) => !v);
          }}
          className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white"
        >
          {showForm ? 'Ocultar formulario' : 'Crear insumo'}
        </button>
      ) : (
        <p className="text-sm text-slate-600">Tu rol tiene acceso de solo lectura.</p>
      )}

      {showForm ? (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block">Nombre *</span>
            <input
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block">Tipo de medida *</span>
            <select
              value={form.measure_type}
              onChange={(e) => onChange('measure_type', e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-2"
            >
              {MEASURE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">{measureTypeHint(form.measure_type)}</span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block">Categoría *</span>
            <select
              value={form.category_id}
              onChange={(e) => onChange('category_id', e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-2"
            >
              <option value="">Selecciona</option>
              {meta.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <InventoryBrandCombo
              valueId={form.brand_id}
              fallbackName={form.brand_id ? form.brand_name : ''}
              disabled={readOnly}
              onBrandFieldsChange={({ brand_id, brand_name }) =>
                setForm((prev) => ({
                  ...prev,
                  brand_id: brand_id || '',
                  brand_name: brand_name || '',
                }))
              }
              onBrandsUpdated={async () => {
                try {
                  const data = await getInventoryItemsMeta();
                  setMeta({
                    categories: data?.categories || [],
                    brands: data?.brands || [],
                    units: data?.units || ['kg', 'litro', 'unidad'],
                  });
                } catch {
                  /* ignore */
                }
              }}
            />
          </div>
          <div className="flex gap-2 lg:col-span-2">
            <button type="submit" disabled={saving} className="rounded bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear insumo'}
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
              <th className="px-3 py-2">Tipo de medida</th>
              <th className="px-3 py-2">Categoría</th>
              <th className="px-3 py-2">Fabricante</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  No hay insumos para mostrar.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{measureTypeLabel(row.unit)}</td>
                  <td className="px-3 py-2">{row.category_name || '—'}</td>
                  <td className="px-3 py-2">{row.brand_name || '—'}</td>
                  <td className="px-3 py-2">{row.is_active ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => openEdit(row)} disabled={saving || readOnly} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">
                        Editar
                      </button>
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => handleToggleActive(row)}
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
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

