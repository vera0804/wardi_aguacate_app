import StatsSectionShell from './StatsSectionShell.jsx';
import StatsAccessDenied from './StatsAccessDenied.jsx';
import { useStatsOverview } from './useStatsOverview.js';
import { crc, num, TableWrap } from './statsFormat.jsx';

export default function StatsCostosPage() {
  const st = useStatsOverview({ includeLowStockInRequest: false });
  if (st.blocked) return <StatsAccessDenied />;

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

  const top10 = (st.data?.expenses_by_category || []).slice(0, 10);

  return (
    <StatsSectionShell
      title="Costos, gastos e inversión"
      description="Gastos directos a lote, intensidad por hectárea, rubros de gasto y costo total por kg frente a la producción del periodo."
      filtersProps={filtersProps}
      periodLine={periodLine}
    >
      {st.loading && !st.data ? <p className="text-sm text-stone-500">Cargando datos…</p> : null}
      {st.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{st.error}</div>
      ) : null}

      {st.data ? (
        <div className="space-y-10">
          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Gastos directos a lote (tabla expenses)</h2>
            <p className="mb-3 text-sm text-stone-600">Solo gastos de lote activos en el periodo; no incluye labores ni insumos.</p>
            {st.data.direct_expenses_by_lot?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.direct_expenses_by_lot.map((r) => (
                    <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-stone-800">{r.lot_name}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin gastos directos a lote en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Gastos directos por finca</h2>
            <p className="mb-3 text-sm text-stone-600">Suma de la tabla anterior por finca.</p>
            {st.data.direct_expenses_by_farm?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.direct_expenses_by_farm.map((r) => (
                    <tr key={r.farm_id || r.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin datos.
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo total por hectárea (lote)</h2>
              <p className="mb-3 text-sm text-stone-600">
                Costos directos imputados al lote (gastos, labores, insumos, asignaciones, nómina y depreciación de
                activos prorrateada por ha) ÷ área del lote.
              </p>
              {st.data.cost_per_ha_by_lot?.some((x) => x.cost_per_ha_crc != null) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ha</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">₡/Ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.cost_per_ha_by_lot
                      .filter((x) => x.cost_per_ha_crc != null)
                      .map((x) => (
                        <tr key={x.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">
                            {x.farm_name} — {x.lot_name}
                          </td>
                          <td className="p-3 text-right tabular-nums text-rose-700">{crc(x.cost_crc)}</td>
                          <td className="p-3 text-right tabular-nums">{num(x.area_ha, 2)}</td>
                          <td className="p-3 text-right font-medium tabular-nums text-stone-900">{crc(x.cost_per_ha_crc)}</td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin lotes con área y costo en el periodo.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo total por hectárea (finca)</h2>
              <p className="mb-3 text-sm text-stone-600">Costos de todos los lotes con área, agregados por finca.</p>
              {st.data.cost_per_ha_by_farm?.some((x) => x.cost_per_ha_crc != null) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ha</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">₡/Ha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.cost_per_ha_by_farm
                      .filter((x) => x.cost_per_ha_crc != null)
                      .map((x) => (
                        <tr key={x.farm_id || x.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">{x.farm_name}</td>
                          <td className="p-3 text-right tabular-nums text-rose-700">{crc(x.cost_crc)}</td>
                          <td className="p-3 text-right tabular-nums">{num(x.area_ha, 2)}</td>
                          <td className="p-3 text-right font-medium tabular-nums text-stone-900">{crc(x.cost_per_ha_crc)}</td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin fincas con área y costo en el periodo.
                </div>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Top 10 rubros de gasto (directo a lote)</h2>
            <p className="mb-3 text-sm text-stone-600">Por categoría de gasto según registro en lotes.</p>
            {top10.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Categoría</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {top10.map((r) => (
                    <tr key={r.category} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.category}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin categorías en el periodo.
              </div>
            )}
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo por kg (lote)</h2>
              <p className="mb-3 text-sm text-stone-600">Costos directos totales (incluye depreciación de activos por ha) ÷ kg producidos en el lote.</p>
              {st.data.rentability_lots?.some((r) => Number(r.kg) > 0) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo/kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.rentability_lots
                      .filter((r) => Number(r.kg) > 0)
                      .map((r) => (
                        <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">
                            {r.farm_name} — {r.lot_name}
                          </td>
                          <td className="p-3 text-right tabular-nums">{num(r.kg, 3)}</td>
                          <td className="p-3 text-right tabular-nums font-medium text-stone-900">
                            {crc(Number(r.cost_crc) / Number(r.kg))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin kg producidos por lote en el periodo.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo por kg (finca)</h2>
              <p className="mb-3 text-sm text-stone-600">Costos agregados (incluye depreciación de activos por ha) ÷ kg producidos por finca.</p>
              {st.data.rentability_farms?.some((r) => Number(r.kg) > 0) ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo/kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {st.data.rentability_farms
                      .filter((r) => Number(r.kg) > 0)
                      .map((r) => (
                        <tr key={r.farm_id || r.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                          <td className="p-3 text-stone-800">{r.farm_name}</td>
                          <td className="p-3 text-right tabular-nums">{num(r.kg, 3)}</td>
                          <td className="p-3 text-right tabular-nums font-medium text-stone-900">
                            {crc(Number(r.cost_crc) / Number(r.kg))}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                  Sin kg por finca en el periodo.
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
