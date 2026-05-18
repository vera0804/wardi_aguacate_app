import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAsset, setAssetActive } from '../../services/assetsApi.js';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function AssetViewPage() {
  const { id } = useParams();
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  const [downError, setDownError] = useState('');
  const [busy, setBusy] = useState(false);
  const [downForm, setDownForm] = useState({
    disposition_reason: 'venta',
    disposition_date: today(),
    disposition_notes: '',
  });

  async function refresh() {
    try {
      const a = await getAsset(id);
      setRow(a);
    } catch (e) {
      setError(e?.message || 'No encontrado.');
    }
  }

  useEffect(() => {
    refresh();
  }, [id]);

  async function submitInactivate(e) {
    e.preventDefault();
    setDownError('');
    setBusy(true);
    try {
      await setAssetActive(id, {
        is_active: false,
        disposition_reason: downForm.disposition_reason,
        disposition_date: downForm.disposition_date,
        disposition_notes: downForm.disposition_notes || undefined,
      });
      await refresh();
    } catch (err) {
      setDownError(err?.message || 'No se pudo inactivar.');
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setDownError('');
    setBusy(true);
    try {
      await setAssetActive(id, { is_active: true });
      await refresh();
    } catch (err) {
      setDownError(err?.message || 'No se pudo reactivar.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="space-y-4">
        <Link to="/admin/assets" className="text-sm text-lime-800 hover:underline">
          ← Listado
        </Link>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      </section>
    );
  }
  if (!row) {
    return (
      <p className="text-sm text-slate-600">
        Cargando…
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link to="/admin/assets" className="text-sm text-lime-800 hover:underline">
            ← Listado
          </Link>
          <h3 className="text-base font-semibold text-lime-800">{row.name}</h3>
          <span className="font-mono text-xs text-slate-500">({row.plate})</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/admin/assets/${id}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Editar
          </Link>
          <Link
            to={`/admin/assets/${id}/depreciacion`}
            className="rounded-lg bg-lime-700 px-3 py-2 text-sm font-semibold text-white hover:bg-lime-800"
          >
            Depreciación
          </Link>
        </div>
      </header>

      <dl className="max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <dt className="font-medium text-slate-600">Categoría</dt>
        <dd className="mt-0.5 text-slate-900">{row.category_name}</dd>
        <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Marca / modelo</dt>
        <dd className="mt-0.5 text-slate-900">{[row.brand, row.model].filter(Boolean).join(' ') || '—'}</dd>
        <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Compra</dt>
        <dd className="mt-0.5 text-slate-900">
          {String(row.purchase_date).slice(0, 10)} · CRC {Number(row.purchase_cost).toLocaleString('es-CR')}
          {row.purchase_cost_usd != null ? ` · USD ${Number(row.purchase_cost_usd).toLocaleString('es-CR')}` : ''}
        </dd>
        <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Vida útil / residual</dt>
        <dd className="mt-0.5 text-slate-900">
          {row.useful_life_years} años · residual CRC {Number(row.salvage_value).toLocaleString('es-CR')}
        </dd>
        <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Estado</dt>
        <dd className="mt-0.5">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
              row.is_active ? 'bg-lime-100 text-lime-800' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {row.is_active ? 'Activo' : 'Inactivo'}
          </span>
        </dd>
        {!row.is_active ? (
          <>
            <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Causa de baja</dt>
            <dd className="mt-0.5 text-slate-900">{row.disposition_reason || '—'}</dd>
            <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Fecha efectiva</dt>
            <dd className="mt-0.5 text-slate-900">{row.disposition_date ? String(row.disposition_date).slice(0, 10) : '—'}</dd>
            <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Notas de baja</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{row.disposition_notes || '—'}</dd>
          </>
        ) : null}
        <dt className="mt-2 font-medium text-slate-600 sm:mt-3">Observaciones</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{row.observations || '—'}</dd>
      </dl>

      <p className="max-w-2xl text-xs text-slate-600">
        <strong>Contabilidad:</strong> al inactivar por venta, donación o pérdida, la depreciación de meses posteriores a
        la fecha de baja queda inactiva: no se sigue cargando gasto por depreciación automática sobre ese activo. Los
        meses ya registrados se conservan como histórico.
      </p>

      {downError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{downError}</p>
      ) : null}

      {row.is_active ? (
        <section className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50/80 p-4">
          <h4 className="text-sm font-semibold text-amber-950">Dar de baja el activo</h4>
          <p className="mt-1 text-xs text-amber-900/90">
            Indicá la causa (venta, donación o pérdida) y la fecha efectiva. La depreciación programada en meses futuros
            a esa fecha pasará a estado inactivo.
          </p>
          <form onSubmit={submitInactivate} className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block font-medium text-slate-800">Causa</span>
              <select
                required
                value={downForm.disposition_reason}
                onChange={(e) => setDownForm((f) => ({ ...f, disposition_reason: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="venta">Venta</option>
                <option value="donacion">Donación</option>
                <option value="perdida">Pérdida</option>
              </select>
            </label>
            <label>
              <span className="mb-1 block font-medium text-slate-800">Fecha efectiva de baja</span>
              <input
                type="date"
                required
                value={downForm.disposition_date}
                onChange={(e) => setDownForm((f) => ({ ...f, disposition_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block font-medium text-slate-800">Notas (opcional)</span>
              <textarea
                rows={2}
                value={downForm.disposition_notes}
                onChange={(e) => setDownForm((f) => ({ ...f, disposition_notes: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-50"
              >
                Inactivar activo
              </button>
            </div>
          </form>
        </section>
      ) : (
        <div className="max-w-2xl space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={reactivate}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            Reactivar activo
          </button>
          <p className="text-xs text-slate-500">
            Reactivar limpia causa y fecha de baja; podés volver a calcular depreciación si corresponde.
          </p>
        </div>
      )}
    </section>
  );
}
