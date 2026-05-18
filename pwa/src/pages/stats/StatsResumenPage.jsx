import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canAccessEstadisticas } from '../../layouts/dashboardMenuData.js';
import { fetchStatsOverview } from '../../services/statsApi.js';
import { apiRequest } from '../../services/api.js';
import KpiCard from './KpiCard.jsx';
import { crc, num, defaultDateRange, TableWrap } from './statsFormat.jsx';

export default function StatsResumenPage() {
  const { user } = useAuth();
  const location = useLocation();
  const def = defaultDateRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [farmId, setFarmId] = useState('');
  const [lotId, setLotId] = useState('');
  const [lowStock, setLowStock] = useState('10');
  const [farms, setFarms] = useState([]);
  const [lots, setLots] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const blocked = !canAccessEstadisticas(user);

  const loadFarms = useCallback(async () => {
    try {
      const rows = await apiRequest('/api/farms');
      setFarms(Array.isArray(rows) ? rows : []);
    } catch {
      setFarms([]);
    }
  }, []);

  const loadLots = useCallback(async (fid) => {
    if (!fid) {
      setLots([]);
      return;
    }
    try {
      const rows = await apiRequest(`/api/lots?farm_id=${encodeURIComponent(fid)}`);
      setLots(Array.isArray(rows) ? rows : []);
    } catch {
      setLots([]);
    }
  }, []);

  useEffect(() => {
    loadFarms();
  }, [loadFarms]);

  useEffect(() => {
    loadLots(farmId);
    if (!farmId) setLotId('');
  }, [farmId, loadLots]);

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const overview = await fetchStatsOverview({
        from,
        to,
        farmId: farmId || undefined,
        lotId: lotId || undefined,
        lowStockThreshold: lowStock === '' ? undefined : Number(lowStock),
      });
      setData(overview);
    } catch (e) {
      setData(null);
      setError(e?.message || 'No se pudieron cargar las estadísticas.');
    } finally {
      setLoading(false);
    }
  }, [from, to, farmId, lotId, lowStock]);

  useEffect(() => {
    if (!blocked) refresh();
  }, [blocked, refresh]);

  useEffect(() => {
    const id = location.hash?.replace('#', '');
    if (!id) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
    return () => window.clearTimeout(t);
  }, [location.hash, data]);

  if (blocked) {
    return (
      <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-amber-50/80 p-5 text-sm text-amber-950">
        <p className="font-medium">Acceso restringido</p>
        <p className="mt-1 text-amber-900/90">
          {user?.isSuperadmin && user?.needsTenantSelection ? (
            <>
              Como superadministrador debe{' '}
              <Link to="/superadmin/clients" className="font-medium text-lime-900 underline hover:text-lime-950">
                elegir una organización
              </Link>{' '}
              para ver las estadísticas de ese cliente.
            </>
          ) : (
            <>Tu rol no tiene permiso para ver estadísticas operativas.</>
          )}
        </p>
        <Link to="/stats" className="mt-3 inline-block text-lime-800 hover:underline">
          ← Volver al índice
        </Link>
      </div>
    );
  }

  const cp = data?.cost_production;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-10">
      <div>
        <Link to="/stats" className="mb-2 inline-block text-sm text-stone-500 hover:text-lime-800">
          ← Estadísticas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Resumen operativo</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Costo por kilogramo producido, ingresos según valor declarado en producción, costos operativos asignados a
          lotes y rentabilidad por lote y finca. Ajuste el periodo y los filtros para actualizar los KPI.
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Finca</label>
            <select
              value={farmId}
              onChange={(e) => {
                setFarmId(e.target.value);
                setLotId('');
              }}
              className="min-w-[10rem] rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
            >
              <option value="">Todas</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Lote</label>
            <select
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              disabled={!farmId}
              className="min-w-[10rem] rounded-lg border border-stone-300 px-3 py-2 text-stone-800 disabled:bg-stone-100"
            >
              <option value="">Todos</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Stock bajo (&lt;)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={lowStock}
              onChange={(e) => setLowStock(e.target.value)}
              className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
            />
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            disabled={loading}
            className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-50"
          >
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
        {data?.period ? (
          <p className="mt-3 text-xs text-stone-500">
            Periodo aplicado: {data.period.from} — {data.period.to}
            {data.filters?.farm_id ? ' · Finca filtrada' : ''}
            {data.filters?.lot_id ? ' · Lote filtrado' : ''}
          </p>
        ) : null}
      </div>

      {loading && !data ? <p className="text-sm text-stone-500">Cargando datos…</p> : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      {cp ? (
        <>
          <section>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
              <span aria-hidden>🥑</span> 1.1 Costo y producción
            </h2>
            <p className="mb-4 text-sm text-stone-600">
              Kilos registrados en producción (detalle por calibre), valor de esa producción y costos directos
              imputados a lotes en el mismo rango de fechas.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                highlight
                title="Costo por kg"
                value={cp.cost_per_kg_crc != null ? crc(cp.cost_per_kg_crc) : '—'}
                subtitle={cp.total_kg > 0 ? `Sobre ${num(cp.total_kg, 3)} kg` : 'Sin kilos en el periodo'}
              />
              <KpiCard title="Kg producidos" value={`${num(cp.total_kg, 3)} kg`} subtitle="Suma en el periodo" />
              <KpiCard
                title="Ingresos (valor producción)"
                value={crc(cp.total_revenue_crc)}
                subtitle="Según precio declarado"
              />
              <KpiCard title="Costos directos" value={crc(cp.total_direct_costs_crc)} subtitle="Suma de rubros" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard title="Margen total" value={crc(cp.margin_total_crc)} subtitle="Ingresos − costos" />
              <KpiCard title="Gastos a lote" value={crc(cp.breakdown_crc?.expenses)} subtitle="Gastos directos" />
              <KpiCard title="Labores" value={crc(cp.breakdown_crc?.labor)} subtitle="Lote + finca asignada" />
              <KpiCard title="Insumos (consumos)" value={crc(cp.breakdown_crc?.inventory_consumption)} />
              <KpiCard title="Gastos generales (asign.)" value={crc(cp.breakdown_crc?.general_expense_allocations)} />
              <KpiCard title="Planilla (asign. lotes)" value={crc(cp.breakdown_crc?.payroll_slip_lot_allocations)} />
              <KpiCard title="Nómina fija (asign.)" value={crc(cp.breakdown_crc?.fixed_payroll_allocations)} />
              <KpiCard
                title="Depreciación (activos)"
                value={crc(cp.breakdown_crc?.asset_depreciation)}
                subtitle="Activos y periodos activos; imputada a lotes por ha"
              />
            </div>
          </section>

          <section id="rentabilidad">
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
              <span aria-hidden>📈</span> 1.2 Rentabilidad por lote
            </h2>
            <p className="mb-4 text-sm text-stone-600">
              Ingresos y costos por lote (costos incluyen depreciación de activos imputada por hectárea); margen en
              colores según signo.
            </p>
            {data?.rentability_lots?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-left font-medium text-stone-700">Lote</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ingreso</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">$/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rentability_lots.map((r) => (
                    <tr key={r.lot_id} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-stone-800">{r.lot_name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-800">{num(r.kg, 3)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">{crc(r.revenue_crc)}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.cost_crc)}</td>
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
                Sin filas de rentabilidad por lote en el periodo.
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
              <span aria-hidden>🌳</span> 1.3 Rentabilidad por finca
            </h2>
            <p className="mb-4 text-sm text-stone-600">Agregación de lotes por finca.</p>
            {data?.rentability_farms?.length ? (
              <TableWrap>
                <thead className="border-b border-stone-200 bg-stone-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-stone-700">Finca</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Kg</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Ingreso</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Costo</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen</th>
                    <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Margen/kg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rentability_farms.map((r) => (
                    <tr key={r.farm_id || r.farm_name} className="border-b border-stone-100 hover:bg-stone-50/80">
                      <td className="p-3 text-stone-800">{r.farm_name}</td>
                      <td className="p-3 text-right tabular-nums text-stone-800">{num(r.kg, 3)}</td>
                      <td className="p-3 text-right tabular-nums text-emerald-700">{crc(r.revenue_crc)}</td>
                      <td className="p-3 text-right tabular-nums text-rose-700">{crc(r.cost_crc)}</td>
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
                Sin datos agregados por finca.
              </div>
            )}
          </section>

          <section id="inventario" className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
                <span aria-hidden>📦</span> 1.4 Inventario — consumos
              </h2>
              <p className="mb-4 text-sm text-stone-600">Productos más consumidos en el periodo.</p>
              {data?.inventory_top_consumed?.length ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Ítem</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Cantidad</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inventory_top_consumed.map((r) => (
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
            </div>
            <div>
              <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
                <span aria-hidden>⚠️</span> 1.5 Existencias bajas
              </h2>
              <p className="mb-4 text-sm text-stone-600">Ítems por debajo del umbral de filtros.</p>
              {data?.inventory_low_stock?.length ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Ítem</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Existencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.inventory_low_stock.map((r) => (
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
            </div>
          </section>

          <section className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div>
              <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
                <span aria-hidden>🧑‍🌾</span> 1.6 Labores por tipo
              </h2>
              <p className="mb-4 text-sm text-stone-600">
              Monto total por tipo = jornadas netas (costeo CRC) + planilla variable y nómina fija pagadas a lotes
              prorrateadas según jornadas registradas en el periodo de la planilla o en el mes de nómina fija en cada
              lote. La suma se alinea con labores CRC + planilla variable + nómina fija a lotes.
              </p>
              {data?.labor_by_type?.length ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Tipo</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Registros</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.labor_by_type.map((r) => (
                      <tr key={r.labor_type_id ?? 'payroll-sin-tipo'} className="border-b border-stone-100 hover:bg-stone-50/80">
                        <td className="p-3 text-stone-800">{r.name}</td>
                        <td className="p-3 text-right tabular-nums text-stone-900">{crc(r.amount_crc)}</td>
                        <td className="p-3 text-right tabular-nums text-stone-500">{r.entries_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : (
                <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-500 shadow-sm">
                  Sin labores en el periodo.
                </div>
              )}
            </div>
            <div>
              <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-stone-900">
                <span aria-hidden>💰</span> 1.7 Gastos por categoría
              </h2>
              <p className="mb-4 text-sm text-stone-600">Gastos directos a lote por categoría.</p>
              {data?.expenses_by_category?.length ? (
                <TableWrap>
                  <thead className="border-b border-stone-200 bg-stone-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-stone-700">Categoría</th>
                      <th className="p-3 text-right font-medium text-stone-700 tabular-nums">Monto CRC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expenses_by_category.map((r) => (
                      <tr key={r.category} className="border-b border-stone-100 hover:bg-stone-50/80">
                        <td className="p-3 text-stone-800">{r.category}</td>
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
            </div>
          </section>

          {data?.notes?.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
              <p className="mb-1 font-medium">Alcance del cálculo</p>
              <ul className="list-inside list-disc space-y-1 text-amber-900/90">
                {data.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : !loading && !error ? (
        <p className="text-sm text-stone-500">No hay datos para mostrar.</p>
      ) : null}
    </div>
  );
}
