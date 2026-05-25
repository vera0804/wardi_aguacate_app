import { useCallback, useEffect, useState } from 'react';
import SuperadminShell from '../layouts/SuperadminShell.jsx';
import PlanImpactWarning from '../components/PlanImpactWarning.jsx';
import {
  createSuperadminPlan,
  deactivateSuperadminPlan,
  fetchSuperadminPlanImpact,
  fetchSuperadminPlansAll,
  updateSuperadminPlan,
} from '../services/superadminApi.js';

const EMPTY_FORM = {
  name: '',
  max_farms: '',
  max_lots_per_farm: '',
  max_users_admin: '',
  max_users_operario: '',
  price: '',
  billing_model: 'perpetual',
  trial_days: '',
  description: '',
};

function planToForm(p) {
  if (!p) return { ...EMPTY_FORM };
  return {
    name: p.name || '',
    max_farms: p.max_farms ?? '',
    max_lots_per_farm: p.max_lots_per_farm ?? '',
    max_users_admin: p.max_users_admin ?? '',
    max_users_operario: p.max_users_operario ?? '',
    price: p.price ?? '',
    billing_model: p.billing_model || 'perpetual',
    trial_days: p.trial_days ?? '',
    description: p.description || '',
  };
}

function formToPayload(form) {
  const payload = {
    name: form.name.trim(),
    max_farms: Number(form.max_farms),
    max_lots_per_farm: Number(form.max_lots_per_farm),
    max_users_admin: Number(form.max_users_admin),
    max_users_operario: Number(form.max_users_operario),
    price: Number(form.price),
    billing_model: form.billing_model,
    description: form.description.trim() || null,
  };
  if (form.billing_model === 'trial_days') {
    payload.trial_days = Number(form.trial_days);
  }
  return payload;
}

export default function SuperadminPlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalMode, setModalMode] = useState(null);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [impact, setImpact] = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPlans(await fetchSuperadminPlansAll());
    } catch (e) {
      setError(e?.message || 'No se pudo cargar los planes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadImpact(planId) {
    if (!planId) {
      setImpact(null);
      return null;
    }
    setImpactLoading(true);
    try {
      const data = await fetchSuperadminPlanImpact(planId);
      setImpact(data);
      return data;
    } catch {
      setImpact(null);
      return null;
    } finally {
      setImpactLoading(false);
    }
  }

  function closeModal() {
    setModalMode(null);
    setEditingPlanId(null);
    setForm(EMPTY_FORM);
    setImpact(null);
    setConfirmStep(false);
  }

  function openCreate() {
    setModalMode('create');
    setEditingPlanId(null);
    setForm(EMPTY_FORM);
    setImpact(null);
    setConfirmStep(false);
  }

  function openEdit(plan) {
    setModalMode('edit');
    setEditingPlanId(plan.id);
    setForm(planToForm(plan));
    setConfirmStep(false);
    loadImpact(plan.id);
  }

  async function openDeactivate(plan) {
    setModalMode('deactivate');
    setEditingPlanId(plan.id);
    setForm(planToForm(plan));
    setConfirmStep(false);
    const imp = await loadImpact(plan.id);
    if ((imp?.active_client_count ?? 0) === 0) {
      await runDeactivate(plan.id, false);
    }
  }

  async function runCreate() {
    setSaving(true);
    setError('');
    try {
      await createSuperadminPlan(formToPayload(form));
      await load();
      closeModal();
    } catch (e) {
      setError(e?.message || 'No se pudo crear el plan.');
    } finally {
      setSaving(false);
    }
  }

  async function runUpdate(acknowledge) {
    setSaving(true);
    setError('');
    try {
      await updateSuperadminPlan(editingPlanId, {
        ...formToPayload(form),
        acknowledge_affected_clients: acknowledge,
      });
      await load();
      closeModal();
    } catch (e) {
      if (e?.code === 'PLAN_IMPACT_NOT_ACKNOWLEDGED' && e?.body?.impact) {
        setImpact(e.body.impact);
        setConfirmStep(true);
      } else {
        setError(e?.message || 'No se pudo actualizar el plan.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function runDeactivate(planId, acknowledge) {
    setSaving(true);
    setError('');
    try {
      await deactivateSuperadminPlan(planId, {
        acknowledge_affected_clients: acknowledge,
      });
      await load();
      closeModal();
    } catch (e) {
      if (e?.code === 'PLAN_IMPACT_NOT_ACKNOWLEDGED' && e?.body?.impact) {
        setImpact(e.body.impact);
        setConfirmStep(true);
      } else {
        setError(e?.message || 'No se pudo inactivar el plan.');
      }
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (modalMode === 'create') {
      runCreate();
      return;
    }
    if (modalMode === 'edit') {
      const n = impact?.active_client_count ?? 0;
      if (n > 0 && !confirmStep) {
        setConfirmStep(true);
        return;
      }
      runUpdate(n > 0);
    }
  }

  function handleConfirmDeactivate() {
    runDeactivate(editingPlanId, true);
  }

  const billingModel = form.billing_model;

  return (
    <SuperadminShell
      title="planes"
      subtitle="Catálogo de planes: límites, facturación y vigencia. Antes de editar o inactivar, revise las organizaciones activas afectadas."
    >
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800"
        >
          Nuevo plan
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3">Facturación</th>
                  <th className="py-2 pr-3">Límites</th>
                  <th className="py-2 pr-3">Org. activas</th>
                  <th className="py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-3 pr-3 font-medium text-slate-800">{p.name}</td>
                    <td className="py-3 pr-3">
                      {p.is_active ? (
                        <span className="text-lime-800">Activo</span>
                      ) : (
                        <span className="text-slate-500">Inactivo</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-600">{p.billing_model_label || p.billing_model}</td>
                    <td className="py-3 pr-3 text-xs text-slate-600">
                      {p.max_farms} fincas · {p.max_lots_per_farm} lotes/finca · {p.max_users_admin} adm ·{' '}
                      {p.max_users_operario} op
                    </td>
                    <td className="py-3 pr-3">{p.active_client_count ?? 0}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                          onClick={() => openEdit(p)}
                        >
                          Editar
                        </button>
                        {p.is_active ? (
                          <button
                            type="button"
                            className="rounded border border-amber-600 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-50"
                            onClick={() => openDeactivate(p)}
                          >
                            Inactivar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalMode === 'create' || modalMode === 'edit' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-lime-900">
              {modalMode === 'create' ? 'Nuevo plan' : 'Editar plan'}
            </h2>

            <form className="mt-4 grid gap-3" onSubmit={handleSubmit}>
              <label className="block text-sm">
                <span className="text-slate-600">Nombre</span>
                <input
                  required
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(ev) => setForm((f) => ({ ...f, name: ev.target.value }))}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-600">Máx. fincas</span>
                  <input
                    required
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.max_farms}
                    onChange={(ev) => setForm((f) => ({ ...f, max_farms: ev.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Máx. lotes por finca</span>
                  <input
                    required
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.max_lots_per_farm}
                    onChange={(ev) => setForm((f) => ({ ...f, max_lots_per_farm: ev.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Máx. usuarios admin</span>
                  <input
                    required
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.max_users_admin}
                    onChange={(ev) => setForm((f) => ({ ...f, max_users_admin: ev.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Máx. usuarios operario</span>
                  <input
                    required
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.max_users_operario}
                    onChange={(ev) => setForm((f) => ({ ...f, max_users_operario: ev.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Precio (₡)</span>
                  <input
                    required
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.price}
                    onChange={(ev) => setForm((f) => ({ ...f, price: ev.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-600">Facturación</span>
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.billing_model}
                    onChange={(ev) => setForm((f) => ({ ...f, billing_model: ev.target.value }))}
                  >
                    <option value="perpetual">Sin vencimiento</option>
                    <option value="trial_days">Demo por días</option>
                    <option value="monthly_anchor">Mensual (día ancla)</option>
                  </select>
                </label>
              </div>
              {billingModel === 'trial_days' ? (
                <label className="block text-sm">
                  <span className="text-slate-600">Días de demo</span>
                  <input
                    required
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                    value={form.trial_days}
                    onChange={(ev) => setForm((f) => ({ ...f, trial_days: ev.target.value }))}
                  />
                </label>
              ) : null}
              <label className="block text-sm">
                <span className="text-slate-600">Descripción</span>
                <textarea
                  rows={2}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                  value={form.description}
                  onChange={(ev) => setForm((f) => ({ ...f, description: ev.target.value }))}
                />
              </label>

              {modalMode === 'edit' ? (
                <PlanImpactWarning impact={impact} loading={impactLoading} />
              ) : null}

              {confirmStep && modalMode === 'edit' ? (
                <p className="text-sm font-medium text-amber-900">
                  Confirme que desea aplicar estos cambios a las organizaciones listadas arriba.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-60"
                >
                  {saving
                    ? 'Guardando…'
                    : confirmStep
                      ? 'Sí, guardar cambios'
                      : modalMode === 'edit' && (impact?.active_client_count ?? 0) > 0
                        ? 'Revisar y guardar'
                        : 'Guardar'}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
                  onClick={closeModal}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modalMode === 'deactivate' && (impact?.active_client_count ?? 0) > 0 ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold text-amber-900">Inactivar plan</h2>
            <p className="mt-2 text-sm text-slate-600">
              El plan <strong>{form.name}</strong> no podrá asignarse a organizaciones nuevas. Las siguientes
              organizaciones activas siguen con este plan asignado:
            </p>
            <PlanImpactWarning impact={impact} loading={impactLoading} />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={saving}
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                onClick={handleConfirmDeactivate}
              >
                {saving ? '…' : 'Sí, inactivar plan'}
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                onClick={closeModal}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SuperadminShell>
  );
}
