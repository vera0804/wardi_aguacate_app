import { useEffect, useMemo, useRef, useState } from 'react';
import { createExpenseCategory, listExpenseCategories } from '../../services/expenseCategoriesApi.js';
import { categoryNameKey, formatAssetCategoryName } from '../../utils/assetCategoryName.js';

/**
 * Misma UX que categoría de activos: escribir para filtrar y crear si no existe.
 */
export default function ExpenseCategoryCombo({
  valueId,
  onValueChange,
  disabled = false,
  onCategoriesUpdated,
}) {
  const [categories, setCategories] = useState([]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);

  async function loadCats() {
    try {
      const data = await listExpenseCategories({ active: 'true' });
      setCategories(Array.isArray(data) ? data : []);
    } catch {
      setCategories([]);
    }
  }

  useEffect(() => {
    loadCats();
  }, []);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const activeCats = useMemo(() => categories.filter((c) => c.is_active), [categories]);

  const filtered = useMemo(() => {
    const q = input.trim();
    if (!q) return activeCats;
    const k = categoryNameKey(q);
    return activeCats.filter((c) => categoryNameKey(c.name).includes(k));
  }, [activeCats, input]);

  const canCreate =
    input.trim().length > 0 && filtered.length === 0 && !creating;

  useEffect(() => {
    const sel = categories.find((c) => String(c.id) === String(valueId));
    if (sel) setInput(sel.name);
    else if (!valueId) setInput('');
  }, [valueId, categories]);

  function selectCat(c) {
    onValueChange(String(c.id));
    setInput(c.name);
    setOpen(false);
    setError('');
  }

  async function createFromInput() {
    const raw = input.trim();
    if (!raw) return;
    const name = formatAssetCategoryName(raw);
    if (!name) return;
    const existing = categories.find((c) => categoryNameKey(c.name) === categoryNameKey(name));
    if (existing) {
      selectCat(existing);
      return;
    }
    setCreating(true);
    setError('');
    try {
      const row = await createExpenseCategory({ name });
      setCategories((prev) =>
        [...prev.filter((c) => String(c.id) !== String(row.id)), row].sort((a, b) =>
          categoryNameKey(a.name).localeCompare(categoryNameKey(b.name), 'es')
        )
      );
      onValueChange(String(row.id));
      setInput(row.name);
      setOpen(false);
      onCategoriesUpdated?.();
    } catch (err) {
      setError(err?.message || 'No se pudo crear la categoría.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative block text-sm">
      <span className="mb-1 block font-medium text-slate-800">Categoría *</span>
      <input
        type="text"
        autoComplete="off"
        disabled={disabled}
        value={input}
        onChange={(e) => {
          const v = e.target.value;
          setInput(v);
          setOpen(true);
          if (!v.trim()) onValueChange('');
          else {
            const sel = categories.find((c) => String(c.id) === String(valueId));
            if (sel && categoryNameKey(sel.name) !== categoryNameKey(v)) onValueChange('');
          }
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
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => selectCat(c)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-lime-50"
                  >
                    {c.name}
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
                {creating ? 'Creando…' : `Crear categoría «${formatAssetCategoryName(input)}»`}
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
