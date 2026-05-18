import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getGeneralExpense,
  listGeneralExpenseAllocations,
  seedGeneralExpenseAllocations,
  patchAllocation,
} from '../../services/expensesApi.js';

function fmtCrc(n) {
  return Number(n || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' });
}

export default function GeneralExpenseDetailPage() {
  const { id } = useParams();
  const [expense, setExpense] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [e, a] = await Promise.all([getGeneralExpense(id), listGeneralExpenseAllocations(id)]);
      setExpense(e);
      setAllocations(Array.isArray(a) ? a : []);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar.');
      setExpense(null);
      setAllocations([]);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSeed() {
    setBusy(true);
    setError('');
    try {
      await seedGeneralExpenseAllocations(id);
      await load();
    } catch (e) {
      setError(e?.message || 'No se pudo generar líneas.');
    } finally {
      setBusy(false);
    }
  }

  async function updateRowPct(rowId, pctStr) {
    const pct = Number(pctStr);
    if (!Number.isFinite(pct)) return;
    setBusy(true);
    try {
      await patchAllocation(rowId, { allocation_pct: pct });
      await load();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar.');
    } finally {
      setBusy(false);
    }
  }

  async function updateRowAmt(rowId, amtStr) {
    const amt = Number(amtStr);
    if (!Number.isFinite(amt)) return;
    setBusy(true);
    try {
      await patchAllocation(rowId, { amount_allocated: amt });
      await load();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar.');
    } finally {
      setBusy(false);
    }
  }

  const sumPct = useMemo(
    () => allocations.reduce((acc, a) => acc + Number(a.allocation_pct || 0), 0),
    [allocations]
  );
  const sumAmt = useMemo(
    () => allocations.reduce((acc, a) => acc + Number(a.amount_allocated || 0), 0),
    [allocations]
  );
  const totalCrc = useMemo(() => Number(expense?.amount_crc || 0), [expense]);
  const pctDelta = 100 - sumPct;
  const amtDelta = totalCrc - sumAmt;
  const pctOk = Math.abs(sumPct - 100) <= 0.02;
  const amtOk = Math.abs(sumAmt - totalCrc) <= 0.05;

  if (loading) {
    return <p className="text-sm text-slate-600">Cargando…</p>;
  }
  if (!expense) {
    return (
      <p className="text-sm text-rose-700">
        {error || 'No encontrado.'}{' '}
        <Link to="/expenses/historial" className="text-lime-800 underline">
          Volver
        </Link>
      </p>
    );
  }

  const isManual = expense.allocation_method === 'manual';
  const isArea = expense.allocation_method === 'area_ha';

  return (
    <div className="space-y-4">
      <div>
        <Link to="/expenses/historial" className="text-sm text-lime-800 hover:underline">
          ← Volver al listado
        </Link>
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

      <header className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-base font-semibold text-lime-800">{expense.category}</h3>
            <p className="text-sm text-slate-600">
              {String(expense.exp_date || '').slice(0, 10)} · Alcance:{' '}
              <strong>{expense.farm_id ? expense.farm_name || 'Finca' : 'Todas las fincas (todos los lotes con área)'}</strong>{' '}
              · Total{' '}
              <strong>{Number(expense.amount_crc || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' })}</strong>
            </p>
        <p className="mt-1 text-xs text-slate-600">
          Reparto:{' '}
          <strong>
            {expense.allocation_method === 'manual'
              ? 'manual entre lotes (según finca al crear el gasto)'
              : 'por hectáreas entre lotes'}
          </strong>
        </p>
        {expense.description ? <p className="mt-2 text-sm text-slate-700">{expense.description}</p> : null}
      </header>

      {isManual ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleSeed}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Generar líneas por lote
          </button>
        </div>
      ) : null}

      {isManual && allocations.length > 0 ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            pctOk && amtOk ? 'border-emerald-200 bg-emerald-50/80 text-emerald-900' : 'border-amber-200 bg-amber-50/90 text-amber-950'
          }`}
        >
          <p>
            <span className="font-medium">Suma de %:</span> {sumPct.toFixed(3)}%
            {pctOk ? (
              <span className="text-emerald-800"> · 100% completo.</span>
            ) : pctDelta > 0.02 ? (
              <span> · Falta {pctDelta.toFixed(3)}% para llegar al 100%.</span>
            ) : (
              <span> · Excede {Math.abs(pctDelta).toFixed(3)}% sobre el 100%.</span>
            )}
          </p>
          <p className="mt-1">
            <span className="font-medium">Suma asignada (CRC):</span> {fmtCrc(sumAmt)}
            {amtOk ? (
              <span className="text-emerald-800"> · Coincide con el total del gasto.</span>
            ) : amtDelta > 0.05 ? (
              <span> · Falta asignar {fmtCrc(amtDelta)}.</span>
            ) : (
              <span> · Excede el total en {fmtCrc(Math.abs(amtDelta))}.</span>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Los cambios se guardan al salir de cada campo. Ajuste % o montos hasta que ambos indicadores queden en verde.
          </p>
        </div>
      ) : null}

      {isArea ? (
        <p className="text-sm text-slate-600">
          Las filas se generan o actualizan en el servidor según el <strong>área (ha)</strong> de cada lote dentro del
          alcance del gasto (finca elegida o todas las fincas si no hay finca). Si no aparecen líneas, revise que los
          lotes tengan área &gt; 0 y estén activos.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-3 py-2 text-left">Lote</th>
              <th className="px-3 py-2 text-left">Finca</th>
              <th className="px-3 py-2 text-right">%</th>
              <th className="px-3 py-2 text-right">Asignado CRC</th>
              {isManual ? <th className="px-3 py-2 text-left">Editar</th> : null}
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={isManual ? 5 : 4} className="px-3 py-6 text-center text-slate-500">
                  {isManual ? 'Sin líneas. Use «Generar líneas por lote».' : 'Sin asignaciones (revise áreas de lotes o estado del gasto).'}
                </td>
              </tr>
            ) : (
              allocations.map((a) => (
                <tr key={`${a.id}-${a.allocation_pct ?? 'p'}-${a.amount_allocated ?? 'm'}`} className="border-t border-slate-200">
                  <td className="px-3 py-2">{a.lot_name}</td>
                  <td className="px-3 py-2">{a.farm_name || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{a.allocation_pct != null ? a.allocation_pct : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {a.amount_allocated != null
                      ? Number(a.amount_allocated).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' })
                      : '—'}
                  </td>
                  {isManual ? (
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 sm:flex-row">
                        <input
                          type="number"
                          step="0.001"
                          placeholder="%"
                          defaultValue={a.allocation_pct ?? ''}
                          onBlur={(e) => updateRowPct(a.id, e.target.value)}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                        <input
                          type="number"
                          step="0.01"
                          placeholder="CRC"
                          defaultValue={a.amount_allocated ?? ''}
                          onBlur={(e) => updateRowAmt(a.id, e.target.value)}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
