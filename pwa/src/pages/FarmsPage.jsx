import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  activateFarm,
  createFarm,
  inactivateFarm,
  listFarms,
  updateFarm,
} from '../services/farms.js';
import { listCantons, listDistricts, listProvinces } from '../services/geo.js';

const DEFAULT_FORM = {
  name: '',
  province_id: '',
  canton_id: '',
  district_id: '',
  community: '',
  area_ha: '0',
  labor_allocation_mode: 'manual',
};

function formatArea(value) {
  if (value == null) return '—';
  return Number(value).toFixed(2);
}

function farmLocationLabel(farm) {
  if (farm?.location_display) return farm.location_display;
  const parts = [
    farm?.province_name,
    farm?.canton_name,
    farm?.district_name,
    farm?.community,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export default function FarmsPage({ user }) {
  const [farms, setFarms] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editingId, setEditingId] = useState(null);
  const [provinces, setProvinces] = useState([]);
  const [cantons, setCantons] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [geoLoading, setGeoLoading] = useState(false);

  const readOnly = false;

  const filteredFarms = useMemo(() => {
    const term = String(searchTerm || '')
      .trim()
      .toLowerCase();
    if (!term) return farms;

    return farms.filter((farm) => {
      const byName = String(farm?.name || '')
        .toLowerCase()
        .includes(term);
      const byLocation = farmLocationLabel(farm).toLowerCase().includes(term);
      return byName || byLocation;
    });
  }, [farms, searchTerm]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await listFarms({ includeInactive });
      setFarms(data || []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar las fincas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [includeInactive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listProvinces();
        if (!cancelled) setProvinces(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setProvinces([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCantons = useCallback(async (provinceId) => {
    if (!provinceId) {
      setCantons([]);
      return;
    }
    setGeoLoading(true);
    try {
      const rows = await listCantons(provinceId);
      setCantons(Array.isArray(rows) ? rows : []);
    } catch {
      setCantons([]);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  const loadDistricts = useCallback(async (cantonId) => {
    if (!cantonId) {
      setDistricts([]);
      return;
    }
    setGeoLoading(true);
    try {
      const rows = await listDistricts(cantonId);
      setDistricts(Array.isArray(rows) ? rows : []);
    } catch {
      setDistricts([]);
    } finally {
      setGeoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!form.province_id) {
      setCantons([]);
      return;
    }
    loadCantons(form.province_id);
  }, [form.province_id, loadCantons]);

  useEffect(() => {
    if (!form.canton_id) {
      setDistricts([]);
      return;
    }
    loadDistricts(form.canton_id);
  }, [form.canton_id, loadDistricts]);

  function resetForm() {
    setForm(DEFAULT_FORM);
    setEditingId(null);
    setShowForm(false);
    setCantons([]);
    setDistricts([]);
  }

  function onChange(field, value) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'province_id') {
        next.canton_id = '';
        next.district_id = '';
      }
      if (field === 'canton_id') {
        next.district_id = '';
      }
      return next;
    });
  }

  function validateForm() {
    if (!String(form.name || '').trim()) {
      return 'El nombre de la finca es obligatorio.';
    }
    if (!String(form.province_id || '').trim()) {
      return 'La provincia es obligatoria.';
    }
    if (form.area_ha !== '' && Number(form.area_ha) < 0) {
      return 'El área (ha) debe ser mayor o igual a 0.';
    }
    return null;
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      province_id: Number(form.province_id),
      canton_id: form.canton_id ? Number(form.canton_id) : null,
      district_id: form.district_id ? Number(form.district_id) : null,
      community: form.community.trim() || null,
      area_ha: form.area_ha === '' ? 0 : Number(form.area_ha),
      labor_allocation_mode: form.labor_allocation_mode,
    };
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
      const payload = buildPayload();
      if (editingId) {
        await updateFarm(editingId, payload);
      } else {
        await createFarm(payload);
      }
      resetForm();
      await refresh();
    } catch (e) {
      setError(e?.message || 'No se pudo guardar la finca.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(farm) {
    if (readOnly) return;
    setSaving(true);
    setError('');
    try {
      if (farm.is_active) {
        await inactivateFarm(farm.id);
      } else {
        await activateFarm(farm.id);
      }
      await refresh();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar el estado de la finca.');
    } finally {
      setSaving(false);
    }
  }

  async function startEdit(farm) {
    setEditingId(farm.id);
    setShowForm(true);
    setForm({
      name: farm.name || '',
      province_id: farm.province_id != null ? String(farm.province_id) : '',
      canton_id: farm.canton_id != null ? String(farm.canton_id) : '',
      district_id: farm.district_id != null ? String(farm.district_id) : '',
      community: farm.community || '',
      area_ha: farm.area_ha ?? 0,
      labor_allocation_mode: farm.labor_allocation_mode || 'manual',
    });
    if (farm.province_id) {
      await loadCantons(farm.province_id);
    }
    if (farm.canton_id) {
      await loadDistricts(farm.canton_id);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Fincas</h3>
          <p className="text-sm text-slate-600">
            Gestiona fincas por cliente. Las activas se muestran por defecto.
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
            Incluir inactivas
          </label>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por nombre o ubicación"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-72"
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
            {showForm ? 'Ocultar formulario' : 'Crear finca'}
          </button>
        ) : null}
        {readOnly ? (
          <p className="text-sm text-slate-600">Tu rol tiene acceso de solo lectura.</p>
        ) : null}
      </div>

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-3"
        >
          <label className="text-sm lg:col-span-3">
            <span className="mb-1 block font-medium">Nombre *</span>
            <input
              value={form.name}
              onChange={(e) => onChange('name', e.target.value)}
              disabled={readOnly || saving}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Provincia *</span>
            <select
              value={form.province_id}
              onChange={(e) => onChange('province_id', e.target.value)}
              disabled={readOnly || saving}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="">Seleccione provincia</option>
              {provinces.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Cantón</span>
            <select
              value={form.canton_id}
              onChange={(e) => onChange('canton_id', e.target.value)}
              disabled={readOnly || saving || !form.province_id || geoLoading}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
            >
              <option value="">Seleccione cantón (opcional)</option>
              {cantons.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Distrito</span>
            <select
              value={form.district_id}
              onChange={(e) => onChange('district_id', e.target.value)}
              disabled={readOnly || saving || !form.canton_id || geoLoading}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
            >
              <option value="">Seleccione distrito (opcional)</option>
              {districts.map((d) => (
                <option key={d.id} value={String(d.id)}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm lg:col-span-3">
            <span className="mb-1 block font-medium">Poblado o comunidad</span>
            <input
              value={form.community}
              onChange={(e) => onChange('community', e.target.value)}
              disabled={readOnly || saving}
              placeholder="Opcional"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium">Área (ha)</span>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.area_ha}
              onChange={(e) => onChange('area_ha', e.target.value)}
              disabled={readOnly || saving}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>

          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block font-medium">Método de asignación de costos</span>
            <select
              value={form.labor_allocation_mode}
              onChange={(e) => onChange('labor_allocation_mode', e.target.value)}
              disabled={readOnly || saving}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              <option value="manual">Manual</option>
              <option value="area">Por área</option>
            </select>
            <p className="mt-1 text-xs text-slate-600">
              Manual: defines porcentajes por lote al registrar labores. Por área: reparte según el área de cada lote.
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-3">
            <button
              type="submit"
              disabled={readOnly || saving}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {editingId ? 'Guardar cambios' : 'Crear finca'}
            </button>
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Ubicación</th>
              <th className="px-3 py-2 text-left">Área (ha)</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  Cargando fincas...
                </td>
              </tr>
            ) : filteredFarms.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No hay fincas que coincidan con el filtro.
                </td>
              </tr>
            ) : (
              filteredFarms.map((farm) => (
                <tr key={farm.id} className="border-t border-slate-200">
                  <td className="px-3 py-2 font-medium">{farm.name}</td>
                  <td className="px-3 py-2">{farmLocationLabel(farm)}</td>
                  <td className="px-3 py-2">{formatArea(farm.area_ha)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        farm.is_active
                          ? 'bg-lime-100 text-lime-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {farm.is_active ? 'Activa' : 'Inactiva'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(farm)}
                        disabled={readOnly || saving}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(farm)}
                        disabled={readOnly || saving}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                      >
                        {farm.is_active ? 'Inactivar' : 'Activar'}
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
