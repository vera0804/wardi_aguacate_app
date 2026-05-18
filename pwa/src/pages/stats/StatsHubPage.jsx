import { Link } from 'react-router-dom';

const MODULES = [
  {
    to: '/stats/produccion',
    emoji: '🥑',
    title: '1. Producción y rendimiento',
    description:
      'Costo por kg, producción total, comparación por lotes y fincas, rendimiento por hectárea, curva de cosecha y kg por calibre.',
  },
  {
    to: '/stats/costos',
    emoji: '💰',
    title: '2. Costos, gastos e inversión',
    description:
      'Gastos por finca y lote, costo por hectárea, top 10 rubros de gasto y costo por kg a nivel lote y finca.',
  },
  {
    to: '/stats/mano-obra',
    emoji: '🧑‍🌾',
    title: '3. Mano de obra (labores y planilla)',
    description:
      'Inversión en mano de obra, costo por tipo de labor, mano de obra por kg producido y picos por semana, mes y año.',
  },
  {
    to: '/stats/inventario',
    emoji: '📦',
    title: '4. Inventario y agroinsumos',
    description: 'Productos más usados, costo por insumo y lote en el periodo, y stock crítico según umbral.',
  },
  {
    to: '/stats/rentabilidad',
    emoji: '📈',
    title: '5. Rentabilidad',
    description:
      'Fincas y lotes más rentables, margen por kg, y comparación de costo total frente a producción e ingresos por lote.',
  },
];

export default function StatsHubPage() {
  return (
    <div className="mx-auto w-full min-w-0 max-w-3xl">
      <h1 className="mb-2 text-xl font-semibold text-stone-800">Estadísticas</h1>
      <p className="mb-8 text-sm text-stone-600">
        Indicadores y análisis de la operación del cultivo de aguacate. En cada módulo puede filtrar por{' '}
        <strong>rango de fechas</strong>, <strong>finca</strong> y <strong>lote</strong>; en inventario también por umbral
        de stock bajo. En algunas pantallas verá la sigla{' '}
        <dfn title="Indicadores clave de desempeño">KPI</dfn> (indicadores clave de desempeño).
      </p>
      <ul className="space-y-3">
        {MODULES.map((m) => (
          <li key={m.to}>
            <Link
              to={m.to}
              className="group flex items-center gap-4 rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-lime-400 hover:bg-lime-50/50"
            >
              <span className="text-2xl" aria-hidden>
                {m.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-stone-900 group-hover:text-lime-900">{m.title}</span>
                <p className="mt-0.5 text-sm text-stone-500">{m.description}</p>
              </div>
              <span className="shrink-0 text-stone-400 transition group-hover:text-lime-700">→</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-xs text-stone-500">
        ¿Prefiere una sola página con todo mezclado?{' '}
        <Link to="/stats/resumen" className="font-medium text-lime-800 underline hover:text-lime-900">
          Ver resumen integral
        </Link>
      </p>
    </div>
  );
}
