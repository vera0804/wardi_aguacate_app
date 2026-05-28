import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { listWorkers } from '../../services/workers.js';
import {
  calculatePayrollSlip,
  listPayrollSlips,
  recalculatePayrollSlip,
  updatePayrollSlipStatus,
} from '../../services/payrollSlipsApi.js';

function monthToCalendarRange(ym) {
  if (!ym || ym.length < 7) return { from: '', to: '' };
  const [y, m] = ym.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

const STATUS_LABEL = {
  calculada: 'Calculada',
  pagada: 'Pagada',
  cancelada: 'Cancelada',
};

export default function PayrollCalculationPage({ user }) {
  const [workers, setWorkers] = useState([]);
  const [slips, setSlips] = useState([]);
  const [slipLoading, setSlipLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const [slipFilterWorkerId, setSlipFilterWorkerId] = useState('');
  const [slipFilterFrom, setSlipFilterFrom] = useState('');
  const [slipFilterTo, setSlipFilterTo] = useState('');
  const [slipFilterStatus, setSlipFilterStatus] = useState('default');

  const [workerId, setWorkerId] = useState('');
  const [monthYm, setMonthYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [receivesAguinaldo, setReceivesAguinaldo] = useState(true);
  const [declaresCcss, setDeclaresCcss] = useState(true);
  const [monthlyGross, setMonthlyGross] = useState('');

  const readOnly = false;

  const selectedWorker = useMemo(
    () => workers.find((w) => w.id === workerId),
    [workers, workerId]
  );
  const isFixed = selectedWorker?.worker_type === 'fijo';

  const slipListParams = useMemo(() => {
    const p = {};
    if (slipFilterWorkerId) p.worker_id = slipFilterWorkerId;
    if (slipFilterFrom) p.period_from = slipFilterFrom;
    if (slipFilterTo) p.period_to = slipFilterTo;
    if (slipFilterStatus === 'all') p.status = 'all';
    else if (slipFilterStatus !== 'default') p.status = slipFilterStatus;
    return p;
  }, [slipFilterWorkerId, slipFilterFrom, slipFilterTo, slipFilterStatus]);

  const loadWorkers = useCallback(async () => {
    try {
      const w = await listWorkers({ active: 'true', type: '' });
      setWorkers(w || []);
    } catch {
      /* ignore; form still usable */
    }
  }, []);

  const loadSlips = useCallback(async () => {
    setSlipLoading(true);
    setListError('');
    try {
      const s = await listPayrollSlips(slipListParams);
      setSlips(s || []);
    } catch (e) {
      setListError(e?.message || 'No se pudieron cargar las planillas.');
    } finally {
      setSlipLoading(false);
    }
  }, [slipListParams]);

  useEffect(() => {
    loadWorkers();
  }, [loadWorkers]);

  useEffect(() => {
    loadSlips();
  }, [loadSlips]);

  async function handleCalculate(e) {
    e.preventDefault();
    if (readOnly) return;
    setFormError('');
    if (!workerId) {
      setFormError('Seleccione un trabajador.');
      return;
    }
    let period_from;
    let period_to;
    if (isFixed) {
      const { from, to } = monthToCalendarRange(monthYm);
      period_from = from;
      period_to = to;
    } else {
      period_from = fromDate;
      period_to = toDate;
      if (!period_from || !period_to) {
        setFormError('Indique fecha desde y hasta.');
        return;
      }
      if (period_from > period_to) {
        setFormError('La fecha desde no puede ser posterior a la fecha hasta.');
        return;
      }
    }
    const payload = {
      worker_id: workerId,
      period_from,
      period_to,
      receives_aguinaldo: receivesAguinaldo,
      declares_ccss: declaresCcss,
    };
    if (isFixed) {
      if (!monthlyGross.trim()) {
        setFormError('Indique el salario mensual bruto.');
        return;
      }
      payload.monthly_gross = Number(monthlyGross);
    }
    setSaving(true);
    try {
      await calculatePayrollSlip(payload);
      await loadSlips();
    } catch (e2) {
      setFormError(e2?.message || 'No se pudo calcular la planilla.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRecalculate(id) {
    if (readOnly) return;
    if (!window.confirm('¿Recalcular esta planilla con las labores y reglas vigentes?')) return;
    setSaving(true);
    setListError('');
    try {
      await recalculatePayrollSlip(id, {});
      await loadSlips();
    } catch (e) {
      setListError(e?.message || 'No se pudo recalcular la planilla.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(id, status) {
    if (readOnly) return;
    const label = status === 'pagada' ? 'marcar como pagada' : 'cancelar';
    if (!window.confirm(`¿Desea ${label} esta planilla?`)) return;
    setSaving(true);
    setListError('');
    try {
      await updatePayrollSlipStatus(id, status);
      await loadSlips();
      setExpandedId(null);
    } catch (e) {
      setListError(e?.message || 'No se pudo actualizar el estado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
        <h3 className="text-base font-semibold text-lime-800">Calcular planilla</h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Trabajador <strong>fijo</strong>: mes calendario completo, salario mensual bruto; si declara CCSS se aplican
          los porcentajes de la pestaña de nómina (CCSS patrono, otros patrono e INS, etc.; trabajador CCSS como
          registro). Prorrateo del <strong>costo patrono</strong> (bruto + CCSS patrono + otros patrono) según labores
          por lote. <strong>Ocasional</strong>: suma de pagos del periodo y misma lógica.
        </p>

        <form onSubmit={handleCalculate} className="mt-4 grid max-w-2xl grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block font-medium">Trabajador *</span>
            <select
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              disabled={saving || readOnly}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Seleccione…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {[w.first_name, w.last_name_1, w.last_name_2].filter(Boolean).join(' ')} ({w.worker_type})
                </option>
              ))}
            </select>
          </label>

          {isFixed ? (
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Mes a pagar (calendario) *</span>
              <input
                type="month"
                value={monthYm}
                onChange={(e) => setMonthYm(e.target.value)}
                disabled={saving || readOnly}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ) : (
            <>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Periodo — desde *</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  disabled={saving || readOnly}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Periodo — hasta *</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  disabled={saving || readOnly}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            </>
          )}

          {isFixed ? (
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Salario mensual bruto *</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyGross}
                onChange={(e) => setMonthlyGross(e.target.value)}
                disabled={saving || readOnly}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ) : null}

          <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={receivesAguinaldo}
              onChange={(e) => setReceivesAguinaldo(e.target.checked)}
              disabled={saving || readOnly}
              className="h-4 w-4 rounded border-slate-300"
            />
            Recibe aguinaldo (provisión 1/12 del bruto del periodo)
          </label>

          <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={declaresCcss}
              onChange={(e) => setDeclaresCcss(e.target.checked)}
              disabled={saving || readOnly}
              className="h-4 w-4 rounded border-slate-300"
            />
            Se declara en CCSS (requiere regla vigente en &quot;Detalles de pagos de nómina&quot;)
          </label>

          {formError ? <p className="text-sm text-rose-700 md:col-span-2">{formError}</p> : null}

          {!readOnly ? (
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Calcular planilla
              </button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
        <h3 className="text-base font-semibold text-lime-800">Planillas registradas</h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Trabajador</span>
            <select
              value={slipFilterWorkerId}
              onChange={(e) => setSlipFilterWorkerId(e.target.value)}
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
            <span className="mb-1 block text-xs font-medium text-slate-600">Periodo desde</span>
            <input
              type="date"
              value={slipFilterFrom}
              onChange={(e) => setSlipFilterFrom(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Periodo hasta</span>
            <input
              type="date"
              value={slipFilterTo}
              onChange={(e) => setSlipFilterTo(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Estado</span>
            <select
              value={slipFilterStatus}
              onChange={(e) => setSlipFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="default">Calculada o pagada</option>
              <option value="all">Todas</option>
              <option value="calculada">Solo calculada</option>
              <option value="pagada">Solo pagada</option>
              <option value="cancelada">Solo cancelada</option>
            </select>
          </label>
        </div>
        {listError ? (
          <p className="mt-2 text-sm text-rose-700">{listError}</p>
        ) : null}
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Trabajador</th>
                <th className="px-3 py-2">Periodo</th>
                <th className="px-3 py-2">Bruto</th>
                <th className="px-3 py-2">CCSS patrono</th>
                <th className="px-3 py-2">Otros patrono</th>
                <th className="px-3 py-2">CCSS trab.</th>
                <th className="px-3 py-2">Aguinaldo prov.</th>
                <th className="px-3 py-2">Costo patrono</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {slipLoading ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    Cargando…
                  </td>
                </tr>
              ) : slips.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-500">
                    No hay planillas.
                  </td>
                </tr>
              ) : (
                slips.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 font-medium">{r.worker_name || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {fmtDate(r.period_from)} → {fmtDate(r.period_to)}
                      </td>
                      <td className="px-3 py-2">{fmtMoney(r.gross_total)}</td>
                      <td className="px-3 py-2">{fmtMoney(r.employer_ccss_amount)}</td>
                      <td className="px-3 py-2">{fmtMoney(r.employer_other_amount)}</td>
                      <td className="px-3 py-2">{fmtMoney(r.employee_ccss_amount)}</td>
                      <td className="px-3 py-2">{fmtMoney(r.aguinaldo_provision)}</td>
                      <td className="px-3 py-2 font-medium">{fmtMoney(r.total_employer_liability)}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[r.status] || r.status}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="mr-2 text-xs text-slate-600 underline"
                          onClick={() => setExpandedId((id) => (id === r.id ? null : r.id))}
                        >
                          {expandedId === r.id ? 'Ocultar' : 'Lotes'}
                        </button>
                        {r.status === 'calculada' && !readOnly ? (
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
                              onClick={() => handleStatus(r.id, 'pagada')}
                            >
                              Pagar
                            </button>
                            <span className="mx-1 text-slate-300">|</span>
                            <button
                              type="button"
                              disabled={saving}
                              className="text-xs font-semibold text-amber-800 underline"
                              onClick={() => handleStatus(r.id, 'cancelada')}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                    {expandedId === r.id && Array.isArray(r.lot_allocations) && r.lot_allocations.length > 0 ? (
                      <tr className="bg-slate-50">
                        <td colSpan={10} className="px-4 py-2">
                          <p className="mb-1 text-xs font-semibold text-slate-700">Prorrateo por lote</p>
                          <ul className="text-xs text-slate-600">
                            {r.lot_allocations.map((a) => (
                              <li key={a.id}>
                                {a.lot_name || 'Lote'} — {fmtMoney(a.amount_allocated)} (
                                {Number(a.allocation_pct).toFixed(2)} %)
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
