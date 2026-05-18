import { useCallback, useEffect, useMemo, useState } from 'react';
import { listWorkers } from '../../services/workers.js';
import {
  calculateAguinaldoStatement,
  listAguinaldoStatements,
  recalculateAguinaldoStatement,
  updateAguinaldoStatementStatus,
} from '../../services/aguinaldosApi.js';

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

const STATUS_LABEL = {
  calculado: 'Calculado',
  pagado: 'Pagado',
  cancelado: 'Cancelado',
};

export default function PayrollAguinaldosPage({ user }) {
  const [workers, setWorkers] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [filterWorkerId, setFilterWorkerId] = useState('');
  const [filterPeriodFrom, setFilterPeriodFrom] = useState('');
  const [filterPeriodTo, setFilterPeriodTo] = useState('');
  const [filterStatus, setFilterStatus] = useState('default');

  const [calcWorkerId, setCalcWorkerId] = useState('');
  const [legalNovYear, setLegalNovYear] = useState(() => String(new Date().getFullYear()));

  const readOnly = false;

  const listParams = useMemo(() => {
    const p = {};
    if (filterWorkerId) p.worker_id = filterWorkerId;
    if (filterPeriodFrom) p.period_from = filterPeriodFrom;
    if (filterPeriodTo) p.period_to = filterPeriodTo;
    if (filterStatus === 'all') p.status = 'all';
    else if (filterStatus === 'cancelado') p.status = 'cancelado';
    else if (filterStatus === 'pagado') p.status = 'pagado';
    else if (filterStatus === 'calculado') p.status = 'calculado';
    return p;
  }, [filterWorkerId, filterPeriodFrom, filterPeriodTo, filterStatus]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const [w, list] = await Promise.all([
        listWorkers({ active: 'true', type: '' }),
        listAguinaldoStatements(listParams),
      ]);
      setWorkers(w || []);
      setRows(list || []);
    } catch (e) {
      setListError(e?.message || 'No se pudo cargar la información.');
    } finally {
      setLoading(false);
    }
  }, [listParams]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleCalculate(e) {
    e.preventDefault();
    if (readOnly) return;
    setFormError('');
    if (!calcWorkerId) {
      setFormError('Seleccione un trabajador.');
      return;
    }
    const y = Number(legalNovYear);
    if (!Number.isInteger(y) || y < 2000) {
      setFormError('Año de cierre (30 de noviembre) inválido.');
      return;
    }
    setSaving(true);
    try {
      await calculateAguinaldoStatement({
        worker_id: calcWorkerId,
        legal_nov_year: y,
      });
      await refresh();
    } catch (e2) {
      setFormError(e2?.message || 'No se pudo calcular el aguinaldo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecalculate(id) {
    if (readOnly) return;
    if (!window.confirm('¿Recalcular este aguinaldo con las planillas pagadas actuales?')) return;
    setSaving(true);
    setListError('');
    try {
      await recalculateAguinaldoStatement(id);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo recalcular.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(id, status) {
    if (readOnly) return;
    const label = status === 'pagado' ? 'marcar como pagado' : 'cancelar';
    if (!window.confirm(`¿Desea ${label} este registro?`)) return;
    setSaving(true);
    setListError('');
    try {
      await updateAguinaldoStatementStatus(id, status);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo actualizar el estado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
        <h3 className="text-base font-semibold text-lime-800">Aguinaldos</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Periodo legal <strong>1 de diciembre al 30 de noviembre</strong> del año siguiente. El cálculo usa solo{' '}
          <strong>planillas en estado pagada</strong> que se traslapen con ese rango, sumando el bruto devengado e
          igualdad <strong>total / 12</strong> como monto de aguinaldo, sin depender del indicador de aguinaldo en cada
          planilla.
        </p>

        <form onSubmit={handleCalculate} className="mt-4 grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium">Trabajador *</span>
            <select
              value={calcWorkerId}
              onChange={(e) => setCalcWorkerId(e.target.value)}
              disabled={saving || readOnly}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seleccione…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {[w.first_name, w.last_name_1, w.last_name_2].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium">Año de cierre del periodo (30 de noviembre) *</span>
            <input
              type="number"
              min="2000"
              max="2100"
              step="1"
              value={legalNovYear}
              onChange={(e) => setLegalNovYear(e.target.value)}
              disabled={saving || readOnly}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Ej. 2025 → periodo del 1 dic 2024 al 30 nov 2025.
            </span>
          </label>
          {formError ? <p className="text-sm text-rose-700 md:col-span-2">{formError}</p> : null}
          {!readOnly ? (
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Calcular / actualizar aguinaldo
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
        <h3 className="text-base font-semibold text-lime-800">Registros de aguinaldo</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Trabajador</span>
            <select
              value={filterWorkerId}
              onChange={(e) => setFilterWorkerId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Todos</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {[w.first_name, w.last_name_1].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Periodo legal desde</span>
            <input
              type="date"
              value={filterPeriodFrom}
              onChange={(e) => setFilterPeriodFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Periodo legal hasta</span>
            <input
              type="date"
              value={filterPeriodTo}
              onChange={(e) => setFilterPeriodTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Estado</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="default">Calculado o pagado</option>
              <option value="all">Todos</option>
              <option value="calculado">Solo calculado</option>
              <option value="pagado">Solo pagado</option>
              <option value="cancelado">Solo cancelado</option>
            </select>
          </label>
        </div>

        {listError ? <p className="mt-2 text-sm text-rose-700">{listError}</p> : null}

        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Trabajador</th>
                <th className="px-3 py-2">Periodo legal</th>
                <th className="px-3 py-2">Bruto (planillas)</th>
                <th className="px-3 py-2"># Planillas</th>
                <th className="px-3 py-2">Aguinaldo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Cargando…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    No hay registros con los filtros actuales.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{r.worker_name || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {fmtDate(r.legal_period_from)} → {fmtDate(r.legal_period_to)}
                    </td>
                    <td className="px-3 py-2">{fmtMoney(r.total_gross_from_slips)}</td>
                    <td className="px-3 py-2">{r.slip_count}</td>
                    <td className="px-3 py-2 font-medium">{fmtMoney(r.aguinaldo_amount)}</td>
                    <td className="px-3 py-2">{STATUS_LABEL[r.status] || r.status}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.status === 'calculado' && !readOnly ? (
                        <>
                          <button
                            type="button"
                            disabled={saving}
                            className="text-xs font-semibold text-sky-800 underline"
                            onClick={() => handleRecalculate(r.id)}
                          >
                            Recalcular
                          </button>
                          <span className="mx-1 text-slate-300">|</span>
                          <button
                            type="button"
                            disabled={saving}
                            className="text-xs font-semibold text-emerald-800 underline"
                            onClick={() => handleStatus(r.id, 'pagado')}
                          >
                            Pagar
                          </button>
                          <span className="mx-1 text-slate-300">|</span>
                          <button
                            type="button"
                            disabled={saving}
                            className="text-xs font-semibold text-amber-800 underline"
                            onClick={() => handleStatus(r.id, 'cancelado')}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
