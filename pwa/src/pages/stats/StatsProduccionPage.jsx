import KpiCard from './KpiCard.jsx';
import StatsSectionShell from './StatsSectionShell.jsx';
import StatsAccessDenied from './StatsAccessDenied.jsx';
import { useStatsOverview } from './useStatsOverview.js';
import { crc, num, TableWrap } from './statsFormat.jsx';

function fmtPeriod(d) {
  if (d == null) return '—';
  const s = String(d).slice(0, 10);
  return s;
}

function HarvestBars({ rows, valueKey = 'kg' }) {
  const maxVal = Math.max(0.0001, ...rows.map((r) => Number(r[valueKey] || 0)));
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const v = Number(r[valueKey] || 0);
        const w = Math.max(3, Math.round((v / maxVal) * 100));
        return (
          <div key={String(r.period_start)} className="flex items-center gap-2 text-sm">
            <span className="w-28 shrink-0 text-stone-600 sm:w-32">{fmtPeriod(r.period_start)}</span>
            <div className="h-7 min-w-0 flex-1 rounded-md bg-stone-100">
              <div
                className="h-full rounded-md bg-gradient-to-r from-lime-600 to-lime-800/90"
                style={{ width: `${w}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right tabular-nums text-stone-800">
              {num(v, 2)} kg
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function StatsProduccionPage() {
  const st = useStatsOverview({ includeLowStockInRequest: false });
  if (st.blocked) return <StatsAccessDenied />;

  const cp = st.data?.cost_production;
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
      title="Producción y rendimiento"
      description="Indicadores de kilos cosechados, ingresos valorizados, comparación territorial, rendimiento por hectárea y curvas de cosecha en el periodo seleccionado."
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
            <h2 className="mb-3 text-lg font-semibold text-stone-900">Costo y volumen</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                highlight
                title="Costo de producir un kg de aguacate"
                value={cp.cost_per_kg_crc != null ? crc(cp.cost_per_kg_crc) : '—'}
                subtitle="Costos directos imputados ÷ kg producidos en el periodo"
              />
              <KpiCard title="Producción total" value={`${num(cp.total_kg, 3)} kg`} subtitle="Suma en el periodo" />
              <KpiCard
                title="Ingresos (valor producción)"
                value={crc(cp.total_revenue_crc)}
                subtitle="Según precio declarado por calibre"
              />
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Comparación de producción por lote</h2>
            <p className="mb-3 text-sm text-stone-600">Kilos e ingreso declarado por lote (misma base que rentabilidad).</p>
            {st.data?.rentability_lots?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.rentability_lots.map((r) => (
                    <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-stone-800">{r.lot_name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-800">{num(r.kg, 3)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">{crc(r.revenue_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin producción por lote en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Comparación de producción por finca</h2>
            <p className="mb-3 text-sm text-stone-600">Kilos e ingreso agregados por finca.</p>
            {st.data?.rentability_farms?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ingreso</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.rentability_farms.map((r) => (
                    <tr key={r.farm_id || r.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-800">{num(r.kg, 3)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">{crc(r.revenue_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin datos por finca.
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Rendimiento por lote</h2>
              <p className="mb-3 text-sm text-stone-600">Kg por hectárea (requiere área en el lote).</p>
              {st.data?.yield_by_lot?.some((y) => y.kg_per_ha != null) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ha</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg/Ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.yield_by_lot
                      .filter((y) => y.kg_per_ha != null)
                      .map((y) => (
                        <tr key={y.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">
                            {y.farm_name} — {y.lot_name}
                          </td>
                          <td className="p-3 text-right tabular-nums">{num(y.kg, 3)}</td>
                          <td className="p-3 text-right tabular-nums">{num(y.area_ha, 2)}</td>
                          <td className="p-3 text-right font-medium tabular-nums text-lime-900">{num(y.kg_per_ha, 2)}</td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin lotes con área y producción en el periodo para calcular kg/Ha.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Rendimiento por finca</h2>
              <p className="mb-3 text-sm text-stone-600">Suma de kg ÷ suma de hectáreas de lotes con área.</p>
              {st.data?.yield_by_farm?.some((y) => y.kg_per_ha != null) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ha</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg/Ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.yield_by_farm
                      .filter((y) => y.kg_per_ha != null)
                      .map((y) => (
                        <tr key={y.farm_id || y.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">{y.farm_name}</td>
                          <td className="p-3 text-right tabular-nums">{num(y.kg, 3)}</td>
                          <td className="p-3 text-right tabular-nums">{num(y.area_ha, 2)}</td>
                          <td className="p-3 text-right font-medium tabular-nums text-lime-900">{num(y.kg_per_ha, 2)}</td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin fincas con área acumulada y producción en el periodo.
                </div>
              )}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Curva de cosecha (por semana)</h2>
              <p className="mb-3 text-sm text-stone-600">Kilos registrados por semana civil (inicio de semana).</p>
              {st.data?.harvest_weekly_kg?.length ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <HarvestBars rows={st.data.harvest_weekly_kg} />
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin datos semanales en el periodo.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Curva de cosecha (por mes)</h2>
              <p className="mb-3 text-sm text-stone-600">Kilos agrupados por mes calendario.</p>
              {st.data?.harvest_monthly_kg?.length ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <HarvestBars rows={st.data.harvest_monthly_kg} />
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin datos mensuales en el periodo.
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Kg producidos por calibre</h2>
            <p className="mb-3 text-sm text-stone-600">Comparación de volumen por calibre en el periodo.</p>
            {st.data?.production_kg_by_caliber?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Calibre</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.production_kg_by_caliber.map((c) => (
                    <tr key={c.caliber_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{c.caliber_name}</td>
                      <td className="p-3 text-right tabular-nums font-medium text-stone-900">{num(c.kg, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin detalle por calibre en el periodo.
              </div>
            )}
          </section>
        </div>
      ) : !st.loading && !st.error ? (
        <p className="text-sm text-stone-500">No hay datos para mostrar.</p>
      ) : null}
    </StatsSectionShell>
  );
}
