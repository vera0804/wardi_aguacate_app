import StatsSectionShell from './StatsSectionShell.jsx';
import StatsAccessDenied from './StatsAccessDenied.jsx';
import { useStatsOverview } from './useStatsOverview.js';
import { crc, num, TableWrap } from './statsFormat.jsx';

export default function StatsRentabilidadPage() {
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

  const lotsRanked = [...(st.data?.rentability_lots || [])].sort((a, b) => Number(b.margin_crc) - Number(a.margin_crc));
  const farmsRanked = [...(st.data?.rentability_farms || [])].sort(
    (a, b) => Number(b.margin_crc) - Number(a.margin_crc)
  );

  return (
    <StatsSectionShell
      title="Rentabilidad"
      description="Ranking por margen, margen por kilogramo y comparación costo total frente a producción e ingresos por lote."
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
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Lotes más rentables (por margen CRC)</h2>
            <p className="mb-3 text-sm text-stone-600">Ordenados de mayor a menor margen (ingreso − costo directo).</p>
            {lotsRanked.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {lotsRanked.map((r) => (
                    <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-stone-800">{r.lot_name}</td>
                      <td
                        className={`p-3 text-right font-medium tabular-nums ${
                          Number(r.margin_crc) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {crc(r.margin_crc)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-stone-700">
                        {r.margin_per_kg_crc != null ? crc(r.margin_per_kg_crc) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin datos de rentabilidad por lote.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Fincas más rentables</h2>
            <p className="mb-3 text-sm text-stone-600">Agregación de lotes por finca.</p>
            {farmsRanked.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {farmsRanked.map((r) => (
                    <tr key={r.farm_id || r.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td
                        className={`p-3 text-right font-medium tabular-nums ${
                          Number(r.margin_crc) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {crc(r.margin_crc)}
                      </td>
                      <td className="p-3 text-right tabular-nums text-stone-700">
                        {r.margin_per_kg_crc != null ? crc(r.margin_per_kg_crc) : '—'}
                      </td>
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

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Margen por kilogramo producido (lote)</h2>
            <p className="mb-3 text-sm text-stone-600">Misma métrica que en el panel integral: margen ÷ kg.</p>
            {st.data.rentability_lots?.some((r) => r.margin_per_kg_crc != null) ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.rentability_lots
                    .filter((r) => r.margin_per_kg_crc != null)
                    .map((r) => (
                      <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                        <td className="p-3 text-stone-800">
                          {r.farm_name} — {r.lot_name}
                        </td>
                        <td className="p-3 text-right tabular-nums">{num(r.kg, 3)}</td>
                        <td
                          className={`p-3 text-right tabular-nums font-medium ${
                            Number(r.margin_per_kg_crc) >= 0 ? 'text-emerald-800' : 'text-red-700'
                          }`}
                        >
                          {crc(r.margin_per_kg_crc)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-6 text-sm text-stone-500 shadow-sm">
                Sin kg suficientes para calcular margen/kg por lote.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo total del lote vs producción</h2>
            <p className="mb-3 text-sm text-stone-600">
              Costos directos imputados, kilos e ingreso declarado en el periodo (base de margen).
            </p>
            {st.data.rentability_lots?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ingreso</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.rentability_lots.map((r) => (
                    <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">
                        {r.farm_name} — {r.lot_name}
                      </td>
                      <td className="p-3 text-right tabular-nums">{num(r.kg, 3)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">{crc(r.revenue_crc)}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.cost_crc)}</td>
                      <td
                        className={`p-3 text-right font-medium tabular-nums ${
                          Number(r.margin_crc) >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {crc(r.margin_crc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin filas en el periodo.
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
