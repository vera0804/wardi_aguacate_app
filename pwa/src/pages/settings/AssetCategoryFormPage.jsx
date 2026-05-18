import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createAssetCategory, getAssetCategory, updateAssetCategory } from '../../services/assetsApi.js';
import { formatAssetCategoryName } from '../../utils/assetCategoryName.js';

export default function AssetCategoryFormPage({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = mode === 'create';
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isCreate || !id) return;
    (async () => {
      try {
        const c = await getAssetCategory(id);
        setName(c.name || '');
      } catch (e) {
        setError(e?.message || 'No encontrada.');
      }
    })();
  }, [id, isCreate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const normalized = formatAssetCategoryName(name);
      if (isCreate) {
        const row = await createAssetCategory({ name: normalized });
        navigate(`/settings/asset-categories/${row.id}/ver`, { replace: true });
      } else {
        await updateAssetCategory(id, { name: normalized });
        navigate(`/settings/asset-categories/${id}/ver`);
      }
    } catch (err) {
      setError(err?.message || 'Error al guardar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <Link to="/settings/asset-categories" className="text-sm text-lime-800 hover:underline">
          ← Listado
        </Link>
        <h3 className="text-base font-semibold text-lime-800">
          {isCreate ? 'Nueva categoría' : 'Editar categoría'}
        </h3>
      </header>
      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}
      <form
        onSubmit={handleSubmit}
        className="max-w-xl space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      >
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-800">Nombre *</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
          />
          <p className="mt-1 text-xs text-slate-500">
            Se normaliza sin tildes y con la primera letra en mayúscula. No se permiten duplicados aunque cambien las
            tildes.
          </p>
        </label>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-50"
          >
            Guardar
          </button>
          <Link to="/settings/asset-categories" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">
            Cancelar
          </Link>
        </div>
      </form>
    </section>
  );
}
