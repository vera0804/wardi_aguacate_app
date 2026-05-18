import KpiCard from './KpiCard.jsx';
import StatsSectionShell from './StatsSectionShell.jsx';
import StatsAccessDenied from './StatsAccessDenied.jsx';
import { useStatsOverview } from './useStatsOverview.js';
import { crc, num, TableWrap } from './statsFormat.jsx';

function fmtPeriod(d) {
  if (d == null) return '—';
  return String(d).slice(0, 10);
}

function LaborBars({ rows }) {
  const maxVal = Math.max(0.0001, ...rows.map((r) => Number(r.amount_crc || 0)));
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = Number(r.amount_crc || 0);
        const w = Math.max(3, Math.round((v / maxVal) * 100));
        return (
          <div key={String(r.period_start)} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 text-stone-600 sm:w-32">{fmtPeriod(r.period_start)}</span>
            <div className="h-7 min-w-0 flex-1 rounded-md bg-stone-100">
              <div
                className="h-full rounded-md bg-gradient-to-r from-amber-500 to-lime-700/90"
                style={{ width: `${w}%` }}
              />
            </div>
            <span className="w-28 shrink-0 text-right tabular-nums text-stone-800">{crc(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function StatsManoObraPage() {
  const st = useStatsOverview({ includeLowStockInRequest: false });
  if (st.blocked) return <StatsAccessDenied />;

  const cp = st.data?.cost_production;
  const payrollPaidToLots =
    cp?.breakdown_crc?.payroll_slip_lot_allocations != null
      ? Number(cp.breakdown_crc.payroll_slip_lot_allocations)
      : 0;
  const fixedPayrollToLots =
    cp?.breakdown_crc?.fixed_payroll_allocations != null
      ? Number(cp.breakdown_crc.fixed_payroll_allocations)
      : 0;
  const laborNetForCosting =
    cp?.breakdown_crc?.labor != null ? Number(cp.breakdown_crc.labor) : 0;
  /** Labores CRC + planilla variable a lotes + nómina fija pagada a lotes (coherente con la suma de tipos). */
  const laborInvestmentTotal = laborNetForCosting + payrollPaidToLots + fixedPayrollToLots;
  const totalKg = cp?.total_kg != null ? Number(cp.total_kg) : 0;
  const laborPerKgInvestment =
    totalKg > 0 && laborInvestmentTotal > 0 ? laborInvestmentTotal / totalKg : null;

  const periodLine = st.data?.period
    ? `Periodo aplicado: ${st.data.period.from} — ${st.data.period.to}${
        st.data.filters?.farm_id ? ' · Finca filtrada' : ''
      }${st.data.filters?.lot_id ? ' · Lote filtrado' : ''}`
    : null;

  const filtersProps = {
    from: st.from,
    to: st.to,
    farmId: st.farmId,
    lotId: st.lotId,
    lowStock: st.lowStock,
    farms: st.farms,
    lots: st.lots,
    loading: st.loading,
    onFromChange: st.setFrom,
    onToChange: st.setTo,
    onFarmChange: (v) => {
      st.setFarmId(v);
      st.setLotId('');
    },
    onLotChange: st.setLotId,
    onLowStockChange: st.setLowStock,
    onRefresh: st.refresh,
  };

  return (
    <StatsSectionShell
      title="Mano de obra (labores y planilla)"
      description="Resumen de inversión (todos los trabajadores), costo por tipo solo ocasionales, frecuencia de tipos de labor (todos) y picos temporales de jornadas ocasionales."
      filtersProps={filtersProps}
      periodLine={periodLine}
    >
      {st.loading && !st.data ? <p className="text-sm text-stone-500">Cargando datos…</p> : null}
      {st.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{st.error}</div>
      ) : null}

      {cp ? (
        <div className="space-y-10">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-stone-900">Resumen</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                highlight
                title="Inversión en mano de obra"
                value={crc(laborInvestmentTotal)}
                subtitle={`${crc(laborNetForCosting)} labores CRC + ${crc(payrollPaidToLots)} planilla variable a lotes + ${crc(fixedPayrollToLots)} nómina fija a lotes`}
              />
              <KpiCard
                title="Mano de obra por kg producido"
                value={laborPerKgInvestment != null ? crc(laborPerKgInvestment) : '—'}
                subtitle={
                  totalKg > 0
                    ? `Inversión total en M.O. ÷ ${num(totalKg, 3)} kg`
                    : 'Sin kg en el periodo'
                }
              />
              <KpiCard
                title="Planilla pagada (asign. lotes)"
                value={crc(cp.breakdown_crc?.payroll_slip_lot_allocations)}
                subtitle="Variable según planillas en estado pagada"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo por tipo de labor (ocasionales)</h2>
            <p className="mb-3 text-sm text-stone-600">
              Suma los <strong>montos registrados en labores</strong> por tipo (solo trabajadores{' '}
              <strong>ocasionales</strong>), incluidas las jornadas que también figuren en una planilla pagada: aquí
              no se descuenta por planilla; solo se consideran filas con monto distinto de cero.{' '}
              <strong>No incluye</strong> trabajadores fijos ni importes de planilla o nómina fija prorrateados; eso
              sigue en el resumen superior.
            </p>
            {st.data?.labor_cost_by_type_ocasional?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Tipo de labor</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto (CRC)</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.labor_cost_by_type_ocasional.map((r) => (
                    <tr
                      key={String(r.labor_type_id)}
                      className="border-b border-stone-100 hover:bg-stone-50/80"
                    >
                      <td className="p-3 text-stone-800">{r.name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-900">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin jornadas de trabajadores ocasionales con monto en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Tipos de labor más realizados</h2>
            <p className="mb-3 text-sm text-stone-600">
              Número de <strong>registros de labor</strong> distintos por tipo en el alcance del filtro (lote, finca o
              todos los lotes del cliente). Cuenta <strong>todos</strong> los trabajadores (fijos y ocasionales). Un
              mismo día puede contar varias veces si hay varios registros.
            </p>
            {st.data?.labor_type_registrations?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Tipo de labor</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Veces registrado</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.labor_type_registrations.map((r) => (
                    <tr
                      key={String(r.labor_type_id)}
                      className="border-b border-stone-100 hover:bg-stone-50/80"
                    >
                      <td className="p-3 text-stone-800">{r.name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-900">{r.registrations_count}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin registros de labor en el periodo.
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Picos por semana</h2>
              <p className="mb-3 text-sm text-stone-600">
                Suma de montos de jornadas por semana, solo trabajadores <strong>ocasionales</strong>. Los empleados
                fijos no se incluyen en esta serie.
              </p>
              {st.data?.labor_spend_by_week?.length ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <LaborBars rows={st.data.labor_spend_by_week} />
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin datos semanales.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Picos por mes</h2>
              <p className="mb-3 text-sm text-stone-600">
                Igual que la semana: montos de jornadas solo <strong>ocasionales</strong>; fijos fuera del cálculo.
              </p>
              {st.data?.labor_spend_by_month?.length ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <LaborBars rows={st.data.labor_spend_by_month} />
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin datos mensuales.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Picos por año</h2>
              <p className="mb-3 text-sm text-stone-600">
                Agregado por año civil; solo montos de jornadas de trabajadores <strong>ocasionales</strong>.
              </p>
              {st.data?.labor_spend_by_year?.length ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <LaborBars rows={st.data.labor_spend_by_year} />
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin datos anuales.
                </div>
              )}
            </div>
          </section>
        </div>
      ) : !st.loading && !st.error ? (
        <p className="text-sm text-stone-500">No hay datos para mostrar.</p>
      ) : null}
    </StatsSectionShell>
  );
}
