/**
 * Aviso de organizaciones activas que heredarán cambios del plan.
 * @param {{ impact: { message?: string, active_clients?: { id: string, name: string }[], active_client_count?: number }|null, loading?: boolean }} props
 */
export default function PlanImpactWarning({ impact, loading }) {
  if (loading) {
    return (
      <p className="text-sm text-slate-500" role="status">
        Comprobando organizaciones con este plan…
      </p>
    );
  }
  if (!impact) return null;

  const clients = impact.active_clients || [];
  const count = impact.active_client_count ?? clients.length;

  if (count === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        {impact.message || 'Ninguna organización activa usa este plan.'}
      </p>
    );
  }

  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
      role="alert"
    >
      <p className="font-semibold">
        {count} organización{count !== 1 ? 'es' : ''} activa{count !== 1 ? 's' : ''} con este plan
      </p>
      <p className="mt-1 text-amber-900/90">
        {impact.message ||
          'Los cambios en límites y configuración del plan se aplican de inmediato a esas organizaciones.'}
      </p>
      <ul className="mt-2 max-h-32 list-inside list-disc overflow-y-auto text-amber-950">
        {clients.map((c) => (
          <li key={c.id}>{c.name}</li>
        ))}
      </ul>
    </div>
  );
}
