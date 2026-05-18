/**
 * Filtros comunes de estadísticas (fechas, finca, lote). Opcional: umbral de stock bajo.
 */
export default function StatsFiltersBar({
  from,
  to,
  farmId,
  lotId,
  lowStock,
  farms,
  lots,
  loading,
  onFromChange,
  onToChange,
  onFarmChange,
  onLotChange,
  onLowStockChange,
  onRefresh,
  showLowStock = false,
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Desde</label>
          <input
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Hasta</label>
          <input
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            className="rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500">Finca</label>
          <select
            value={farmId}
            onChange={(e) => onFarmChange(e.target.value)}
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
            onChange={(e) => onLotChange(e.target.value)}
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
        {showLowStock ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Stock bajo (&lt;)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={lowStock}
              onChange={(e) => onLowStockChange(e.target.value)}
              className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-stone-800"
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-50"
        >
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>
    </div>
  );
}
