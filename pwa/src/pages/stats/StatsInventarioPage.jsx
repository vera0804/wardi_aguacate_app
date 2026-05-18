import StatsSectionShell from './StatsSectionShell.jsx';
import StatsAccessDenied from './StatsAccessDenied.jsx';
import { useStatsOverview } from './useStatsOverview.js';
import { crc, num, TableWrap } from './statsFormat.jsx';

export default function StatsInventarioPage() {
  const st = useStatsOverview({ includeLowStockInRequest: true });
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

  return (
    <StatsSectionShell
      title="Inventario y agroinsumos"
      description="Productos más utilizados, costo por combinación insumo–lote en el periodo y alertas de existencia baja."
      filtersProps={filtersProps}
      periodLine={periodLine}
      showLowStockInFilters
    >
      {st.loading && !st.data ? <p className="text-sm text-stone-500">Cargando datos…</p> : null}
      {st.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{st.error}</div>
      ) : null}

      {st.data ? (
        <div className="space-y-10">
          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Productos más utilizados</h2>
            <p className="mb-3 text-sm text-stone-600">Cantidad consumida y monto CRC en consumos de inventario.</p>
            {st.data.inventory_top_consumed?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Ítem</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Cantidad</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.inventory_top_consumed.map((r) => (
                    <tr key={r.item_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-800">
                        {num(r.qty, 3)} {r.unit}
                      </td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin consumos en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Costo por producto, finca y lote</h2>
            <p className="mb-3 text-sm text-stone-600">
              Principales combinaciones por monto en el rango de fechas (hasta 40 filas).
            </p>
            {st.data.inventory_consumed_by_item_lot?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Insumo</th>
                    <th className="p-3 text-left font-medium text-stone-700">Finca / lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Cantidad</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.inventory_consumed_by_item_lot.map((r) => (
                    <tr key={`${r.item_id}-${r.lot_id}`} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.item_name}</td>
                      <td className="p-3 text-stone-700">
                        {r.farm_name} — {r.lot_name}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {num(r.qty, 3)} {r.item_unit}
                      </td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.amount_crc)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Sin consumos por lote en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Stock crítico</h2>
            <p className="mb-3 text-sm text-stone-600">
              Ítems cuya existencia total queda por debajo del umbral indicado en filtros (vista global del inventario).
            </p>
            {st.data.inventory_low_stock?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Ítem</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Existencia</th>
                  </tr>
                </thead>
                <tbody>
                  {st.data.inventory_low_stock.map((r) => (
                    <tr key={r.item_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.name}</td>
                      <td className="p-3 text-right tabular-nums text-amber-800">
                        {num(r.qty_remaining, 3)} {r.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                Ningún ítem bajo el umbral.
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
