import { useEffect, useMemo, useRef, useState } from 'react';
import { createInventoryBrand, listInventoryBrands } from '../services/inventoryBrands.js';
import { categoryNameKey, formatAssetCategoryName } from '../utils/assetCategoryName.js';

/**
 * Misma UX que categoría de gastos/activos: escribir para filtrar y crear si no existe.
 * Notifica { brand_id, brand_name }: con id seleccionado/creado, brand_name va vacío;
 * si el usuario escribe sin elegir fila, brand_id vacío y brand_name es el borrador (opcional para API).
 */
export default function InventoryBrandCombo({
  valueId,
  fallbackName = '',
  onBrandFieldsChange,
  disabled = false,
  onBrandsUpdated,
}) {
  const [brands, setBrands] = useState([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  async function loadBrands() {
    try {
      const data = await listInventoryBrands({ active: 'all' });
      setBrands(Array.isArray(data) ? data : []);
    } catch {
      setBrands([]);
    }
  }

  useEffect(() => {
    loadBrands();
  }, []);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const brandsForPick = useMemo(
    () => brands.filter((b) => b.is_active || String(b.id) === String(valueId)),
    [brands, valueId]
  );

  const filtered = useMemo(() => {
    const q = input.trim();
    if (!q) return brandsForPick;
    const k = categoryNameKey(q);
    return brandsForPick.filter((b) => categoryNameKey(b.name).includes(k));
  }, [brandsForPick, input]);

  const canCreate = input.trim().length > 0 && filtered.length === 0 && !creating;

  useEffect(() => {
    const sel = brands.find((b) => String(b.id) === String(valueId));
    if (sel) setInput(sel.name);
    else if (valueId && fallbackName) setInput(fallbackName);
    else if (!valueId) setInput('');
  }, [valueId, brands, fallbackName]);

  function notifyTyping(v) {
    if (!v.trim()) {
      onBrandFieldsChange({ brand_id: '', brand_name: '' });
      return;
    }
    const sel = brands.find((b) => String(b.id) === String(valueId));
    const matchesSelection = sel
      ? categoryNameKey(sel.name) === categoryNameKey(v)
      : valueId && fallbackName
        ? categoryNameKey(fallbackName) === categoryNameKey(v)
        : false;
    if (!matchesSelection) {
      onBrandFieldsChange({ brand_id: '', brand_name: v });
    }
  }

  function selectBrand(b) {
    onBrandFieldsChange({ brand_id: String(b.id), brand_name: '' });
    setInput(b.name);
    setOpen(false);
    setError('');
  }

  async function createFromInput() {
    const raw = input.trim();
    if (!raw) return;
    const name = formatAssetCategoryName(raw);
    if (!name) return;
    const existing = brands.find((b) => categoryNameKey(b.name) === categoryNameKey(name));
    if (existing) {
      selectBrand(existing);
      return;
    }
    setCreating(true);
    setError('');
    try {
      const row = await createInventoryBrand({ name });
      setBrands((prev) =>
        [...prev.filter((b) => String(b.id) !== String(row.id)), row].sort((a, b) =>
          categoryNameKey(a.name).localeCompare(categoryNameKey(b.name), 'es')
        )
      );
      onBrandFieldsChange({ brand_id: String(row.id), brand_name: '' });
      setInput(row.name);
      setOpen(false);
      onBrandsUpdated?.();
    } catch (err) {
      setError(err?.message || 'No se pudo crear la marca.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative block text-sm">
      <span className="mb-1 block font-medium text-slate-800">Fabricante o marca (opcional)</span>
      <input
        type="text"
        autoComplete="off"
        disabled={disabled}
        value={input}
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          setOpen(true);
          notifyTyping(v);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Escriba para buscar…"
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:bg-slate-100"
      />
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
      {open && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg">
          {filtered.length ? (
            <ul className="divide-y divide-slate-100">
              {filtered.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => selectBrand(b)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-lime-50"
                  >
                    {b.name}
                    {!b.is_active ? (
                      <span className="ml-1 text-xs font-normal text-slate-500">(inactiva)</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {canCreate ? (
            <div className="border-t border-slate-100 px-2 py-2">
              <p className="px-1 text-xs text-slate-500">No hay coincidencias.</p>
              <button
                type="button"
                disabled={creating}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={createFromInput}
                className="mt-1 w-full rounded-md border border-lime-600 bg-lime-50 px-2 py-2 text-left text-sm font-medium text-lime-900 hover:bg-lime-100 disabled:opacity-50"
              >
                {creating ? 'Creando…' : `Crear marca «${formatAssetCategoryName(input)}»`}
              </button>
            </div>
          ) : null}
          {!filtered.length && !canCreate && input.trim() ? (
            <p className="px-3 py-2 text-sm text-slate-500">Sin resultados.</p>
          ) : null}
          {!input.trim() && !filtered.length ? (
            <p className="px-3 py-2 text-sm text-slate-500">Escriba un nombre o elija de la lista.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
