/**
 * Resumen de límites y facturación del plan seleccionado (superadmin).
 */
export default function SuperadminPlanSummary({ plan }) {
  if (!plan) return null;

  const price =
    plan.price != null && plan.price !== ''
      ? `₡${Number(plan.price).toLocaleString('es-CR', { maximumFractionDigits: 0 })}`
      : '—';

  const rows = [
    { label: 'Fincas', value: plan.max_farms ?? '—' },
    { label: 'Lotes por finca', value: plan.max_lots_per_farm ?? '—' },
    { label: 'Usuarios administrador', value: plan.max_users_admin ?? '—' },
    { label: 'Usuarios operario', value: plan.max_users_operario ?? '—' },
    { label: 'Precio del plan', value: price },
    {
      label: 'Facturación',
      value: plan.billing_model_label || plan.billing_model || '—',
    },
  ];

  if (String(plan.billing_model || '').toLowerCase() === 'trial_days' && plan.trial_days != null) {
    rows.push({ label: 'Días de demo', value: plan.trial_days });
  }

  return (
    <div
      className="mt-2 rounded-lg border border-lime-200/80 bg-lime-50/60 px-3 py-2.5 text-xs text-slate-700"
      aria-live="polite"
    >
      <p className="font-semibold text-lime-900">{plan.name}</p>
      {plan.description ? (
        <p className="mt-1 text-slate-600">{plan.description}</p>
      ) : null}
      <dl className="mt-2 grid gap-1 sm:grid-cols-2">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex gap-1.5">
            <dt className="shrink-0 text-slate-500">{label}:</dt>
            <dd className="font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
