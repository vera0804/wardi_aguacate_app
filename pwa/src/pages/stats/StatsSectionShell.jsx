import { Link } from 'react-router-dom';
import StatsFiltersBar from './StatsFiltersBar.jsx';

export default function StatsSectionShell({
  title,
  description,
  backHref = '/stats',
  filtersProps,
  showLowStockInFilters = false,
  periodLine,
  children,
}) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-8">
      <div>
        <Link to={backHref} className="mb-2 inline-block text-sm text-stone-500 hover:text-lime-800">
          ← Estadísticas
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-stone-600">{description}</p> : null}
      </div>

      <StatsFiltersBar {...filtersProps} showLowStock={showLowStockInFilters} />

      {periodLine ? <p className="text-xs text-stone-500">{periodLine}</p> : null}

      {children}
    </div>
  );
}
