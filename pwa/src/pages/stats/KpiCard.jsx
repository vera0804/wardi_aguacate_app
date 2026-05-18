/**
 * Tarjeta de KPI: variante estándar (blanco) o destacada (gradiente lime, marca Wardi).
 */
export default function KpiCard({ title, value, subtitle, highlight }) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-sm ${
        highlight
          ? 'bg-gradient-to-br from-lime-700 to-lime-900 border-lime-800 text-white ring-2 ring-lime-500/35'
          : 'border-stone-200 bg-white'
      }`}
    >
      <p
        className={`text-xs font-medium uppercase tracking-wide ${
          highlight ? 'text-lime-200' : 'text-stone-500'
        }`}
      >
        {title}
      </p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${highlight ? 'text-white' : 'text-stone-900'}`}>
        {value}
      </p>
      {subtitle ? (
        <p className={`mt-1 text-xs ${highlight ? 'text-lime-200/90' : 'text-stone-500'}`}>{subtitle}</p>
      ) : null}
    </div>
  );
}
