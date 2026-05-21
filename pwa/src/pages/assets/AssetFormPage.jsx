import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createAsset,
  createAssetCategory,
  getAsset,
  listAssetCategories,
  updateAsset,
} from '../../services/assetsApi.js';
import { categoryNameKey, formatAssetCategoryName } from '../../utils/assetCategoryName.js';
import FxRateUsdField from '../../shared/FxRateUsdField.jsx';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function AssetFormPage({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = mode === 'create';
  const [categories, setCategories] = useState([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const categoryComboRef = useRef(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    category_id: '',
    name: '',
    alias: '',
    brand: '',
    model: '',
    plate: '',
    purchase_date: today(),
    purchase_currency: 'CRC',
    purchase_cost: '',
    purchase_cost_usd: '',
    fx_rate: '',
    useful_life_years: '5',
    salvage_value: '0',
    observations: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const cats = await listAssetCategories();
        setCategories(Array.isArray(cats) ? cats : []);
      } catch {
        setCategories([]);
      }
    })();
  }, []);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!categoryComboRef.current?.contains(e.target)) setCategoryListOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const activeCategorySuggestions = useMemo(
    () => categories.filter((c) => c.is_active),
    [categories]
  );

  const filteredCategories = useMemo(() => {
    const q = categoryInput.trim();
    if (!q) return activeCategorySuggestions;
    const k = categoryNameKey(q);
    return activeCategorySuggestions.filter((c) => categoryNameKey(c.name).includes(k));
  }, [activeCategorySuggestions, categoryInput]);

  const canOfferCreateCategory =
    categoryInput.trim().length > 0 && filteredCategories.length === 0 && !creatingCategory;

  function selectCategory(c) {
    setForm((f) => ({ ...f, category_id: String(c.id) }));
    setCategoryInput(c.name);
    setCategoryListOpen(false);
  }

  async function handleCreateCategoryFromInput() {
    const raw = categoryInput.trim();
    if (!raw) return;
    const name = formatAssetCategoryName(raw);
    if (!name) return;
    const existing = categories.find((c) => categoryNameKey(c.name) === categoryNameKey(name));
    if (existing) {
      selectCategory(existing);
      return;
    }
    setCreatingCategory(true);
    setError('');
    try {
      const row = await createAssetCategory({ name });
      setCategories((prev) =>
        [...prev.filter((c) => String(c.id) !== String(row.id)), row].sort((a, b) =>
          categoryNameKey(a.name).localeCompare(categoryNameKey(b.name), 'es')
        )
      );
      setForm((f) => ({ ...f, category_id: String(row.id) }));
      setCategoryInput(row.name);
      setCategoryListOpen(false);
    } catch (err) {
      setError(err?.message || 'No se pudo crear la categoría.');
    } finally {
      setCreatingCategory(false);
    }
  }

  useEffect(() => {
    if (isCreate || !id) return;
    (async () => {
      try {
        const a = await getAsset(id);
        setCategoryInput(a.category_name || '');
        setForm({
          category_id: a.category_id ? String(a.category_id) : '',
          name: a.name || '',
          alias: a.alias || '',
          brand: a.brand || '',
          model: a.model || '',
          plate: a.plate || '',
          purchase_date: String(a.purchase_date || '').slice(0, 10),
          purchase_currency: a.purchase_cost_usd != null ? 'USD' : 'CRC',
          purchase_cost: a.purchase_cost != null ? String(a.purchase_cost) : '',
          purchase_cost_usd: a.purchase_cost_usd != null ? String(a.purchase_cost_usd) : '',
          fx_rate: '',
          useful_life_years: String(a.useful_life_years || ''),
          salvage_value: a.salvage_value != null ? String(a.salvage_value) : '0',
          observations: a.observations || '',
        });
      } catch (e) {
        setError(e?.message || 'No se pudo cargar el activo.');
      }
    })();
  }, [id, isCreate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.category_id) {
      setError('Elegí una categoría de la lista o creá una nueva.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category_id: form.category_id,
        name: form.name,
        alias: form.alias || undefined,
        brand: form.brand || undefined,
        model: form.model || undefined,
        plate: form.plate || undefined,
        purchase_date: form.purchase_date,
        purchase_currency: form.purchase_currency,
        useful_life_years: Number(form.useful_life_years),
        salvage_value: Number(form.salvage_value || 0),
        observations: form.observations || undefined,
      };
      if (form.purchase_currency === 'CRC') {
        payload.purchase_cost = Number(form.purchase_cost);
      } else {
        payload.purchase_cost_usd = Number(form.purchase_cost_usd);
        if (form.fx_rate) payload.fx_rate = Number(form.fx_rate);
        payload.purchase_cost = Number(form.purchase_cost) || undefined;
      }
      if (isCreate) {
        const row = await createAsset(payload);
        navigate(`/admin/assets/${row.id}/ver`, { replace: true });
      } else {
        await updateAsset(id, payload);
        navigate(`/admin/assets/${id}/ver`);
      }
    } catch (err) {
      setError(err?.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/admin/assets" className="text-sm text-lime-800 hover:underline">
          ← Listado
        </Link>
        <h3 className="text-base font-semibold text-lime-800">{isCreate ? 'Nuevo activo' : 'Editar activo'}</h3>
      </header>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 lg:max-w-5xl lg:grid-cols-2"
      >
        <div ref={categoryComboRef} className="relative block text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Categoría</span>
          <input
            type="text"
            autoComplete="off"
            value={categoryInput}
            onChange={(e) => {
              const v = e.target.value;
              setCategoryInput(v);
              setCategoryListOpen(true);
              setForm((f) => {
                if (!v.trim()) return { ...f, category_id: '' };
                const sel = categories.find((c) => String(c.id) === String(f.category_id));
                if (sel && categoryNameKey(sel.name) !== categoryNameKey(v)) return { ...f, category_id: '' };
                return f;
              });
            }}
            onFocus={() => setCategoryListOpen(true)}
            placeholder="Escribí para buscar…"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
          {categoryListOpen ? (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
              {filteredCategories.length ? (
                <ul className="divide-y divide-slate-100">
                  {filteredCategories.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onMouseDown={(ev) => ev.preventDefault()}
                        onClick={() => selectCategory(c)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-lime-50"
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {canOfferCreateCategory ? (
                <div className="border-t border-slate-100 px-2 py-2">
                  <p className="px-1 text-xs text-slate-500">No hay coincidencias.</p>
                  <button
                    type="button"
                    disabled={creatingCategory}
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={handleCreateCategoryFromInput}
                    className="mt-1 w-full rounded-md border border-lime-600 bg-lime-50 px-2 py-2 text-left text-sm font-medium text-lime-900 hover:bg-lime-100 disabled:opacity-50"
                  >
                    {creatingCategory
                      ? 'Creando categoría…'
                      : `Crear categoría «${formatAssetCategoryName(categoryInput)}»`}
                  </button>
                </div>
              ) : null}
              {!filteredCategories.length && !canOfferCreateCategory && categoryInput.trim() ? (
                <p className="px-3 py-2 text-sm text-slate-500">Sin resultados.</p>
              ) : null}
              {!categoryInput.trim() && !filteredCategories.length ? (
                <p className="px-3 py-2 text-sm text-slate-500">
                  No hay categorías activas. Escribí un nombre y usá «Crear categoría».
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Nombre *</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Alias</span>
          <input
            value={form.alias}
            onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Placa (opcional; si vacía se genera con prefijo W)</span>
          <input
            value={form.plate}
            onChange={(e) => setForm((f) => ({ ...f, plate: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Marca</span>
          <input
            value={form.brand}
            onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Modelo</span>
          <input
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Fecha de compra *</span>
          <input
            type="date"
            required
            value={form.purchase_date}
            onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Moneda de compra</span>
          <select
            value={form.purchase_currency}
            onChange={(e) => setForm((f) => ({ ...f, purchase_currency: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            <option value="CRC">CRC (colones)</option>
            <option value="USD">USD (dólares)</option>
          </select>
        </label>
        {form.purchase_currency === 'CRC' ? (
          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block font-medium text-slate-800">Costo (CRC) *</span>
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={form.purchase_cost}
              onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
          </label>
        ) : (
          <>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-800">Costo (USD) *</span>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.purchase_cost_usd}
                onChange={(e) => setForm((f) => ({ ...f, purchase_cost_usd: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            <FxRateUsdField
              label="Tipo de cambio (CRC por 1 USD)"
              referenceDate={form.purchase_date}
              value={form.fx_rate}
              onChange={(fx_rate) => setForm((f) => ({ ...f, fx_rate }))}
              inputClassName="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            />
            <label className="text-sm lg:col-span-2">
              <span className="mb-1 block font-medium text-slate-800">Costo CRC (opcional)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_cost}
                onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
          </>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Vida útil (años) *</span>
          <input
            type="number"
            min="1"
            step="1"
            required
            value={form.useful_life_years}
            onChange={(e) => setForm((f) => ({ ...f, useful_life_years: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Valor residual (CRC)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.salvage_value}
            onChange={(e) => setForm((f) => ({ ...f, salvage_value: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm lg:col-span-2">
          <span className="mb-1 block font-medium text-slate-800">Observaciones</span>
          <textarea
            rows={3}
            value={form.observations}
            onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-50"
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <Link to="/admin/assets" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
