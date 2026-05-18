import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { calculateAssetDepreciation, getAsset, listAssetDepreciation } from '../../services/assetsApi.js';

export default function AssetDepreciationPage() {
  const { id } = useParams();
  const [asset, setAsset] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const [a, dep] = await Promise.all([
        getAsset(id),
        listAssetDepreciation({ asset_id: id }),
      ]);
      setAsset(a);
      setRows(Array.isArray(dep) ? dep : []);
    } catch (e) {
      setError(e?.message || 'Error al cargar.');
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleCalculate() {
    setBusy(true);
    setError('');
    try {
      const dep = await calculateAssetDepreciation(id);
      setRows(Array.isArray(dep) ? dep : []);
    } catch (e) {
      setError(e?.message || 'No se pudo calcular.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link to="/admin/assets" className="text-sm text-lime-800 hover:underline">
            ← Listado
          </Link>
          <h3 className="text-base font-semibold text-lime-800">Depreciación</h3>
          {asset ? <span className="text-sm text-slate-600">{asset.name}</span> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !asset?.is_active}
            onClick={handleCalculate}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-50"
          >
            {busy ? 'Calculando…' : 'Calcular / actualizar cuadro'}
          </button>
          <Link
            to={`/admin/assets/${id}/ver`}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
          >
            Ver ficha
          </Link>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      ) : null}

      {!asset?.is_active ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          El activo está inactivo: no se puede recalcular depreciación. Los periodos futuros a la baja quedaron inactivos
          contablemente.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Año</th>
              <th className="px-3 py-2 text-left">Mes</th>
              <th className="px-3 py-2 text-left">Monto mes</th>
              <th className="px-3 py-2 text-left">Acumulado</th>
              <th className="px-3 py-2 text-left">Valor en libros</th>
              <th className="px-3 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  Aún no hay depreciación registrada.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-200">
                  <td className="px-3 py-2">{r.period_year}</td>
                  <td className="px-3 py-2">{r.period_month}</td>
                  <td className="px-3 py-2">{Number(r.depreciation_amount).toLocaleString('es-CR')}</td>
                  <td className="px-3 py-2">{Number(r.accumulated_depreciation).toLocaleString('es-CR')}</td>
                  <td className="px-3 py-2">{Number(r.book_value).toLocaleString('es-CR')}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {r.is_active ? 'Activo' : 'Inactivo'}
                    </span>
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
