import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  createSuperadminClient,
  fetchSuperadminClients,
  fetchSuperadminPlans,
  superadminEnterTenant,
} from '../services/superadminApi.js';
import PasswordPolicyHint from '../components/PasswordPolicyHint.jsx';
import { validatePasswordPolicy } from '../utils/passwordPolicy.js';

export default function SuperadminClientsPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    client_name: '',
    plan_id: '',
    admin_email: '',
    admin_password: '',
    admin_first_name: '',
    admin_last_name_1: '',
    admin_last_name_2: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, c] = await Promise.all([fetchSuperadminPlans(), fetchSuperadminClients()]);
      setPlans(p);
      setClients(c);
      setForm((f) => (f.plan_id ? f : { ...f, plan_id: p[0]?.id || '' }));
    } catch (e) {
      setError(e?.message || 'No se pudo cargar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleEnter(clientId) {
    setError('');
    try {
      const profile = await superadminEnterTenant(clientId);
      setUser(profile);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(e?.message || 'No se pudo entrar a la organización.');
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const policyErr = validatePasswordPolicy(form.admin_password);
    if (policyErr) {
      setError(policyErr);
      return;
    }
    setCreating(true);
    setError('');
    try {
      await createSuperadminClient({
        client_name: form.client_name.trim(),
        plan_id: form.plan_id,
        admin_email: form.admin_email.trim(),
        admin_password: form.admin_password,
        admin_first_name: form.admin_first_name.trim(),
        admin_last_name_1: form.admin_last_name_1.trim(),
        admin_last_name_2: form.admin_last_name_2.trim() || undefined,
      });
      setForm((f) => ({
        ...f,
        client_name: '',
        admin_email: '',
        admin_password: '',
        admin_first_name: '',
        admin_last_name_1: '',
        admin_last_name_2: '',
      }));
      await load();
    } catch (e) {
      setError(e?.message || 'No se pudo crear la organización.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <h1 className="text-xl font-semibold text-lime-900">Plataforma — organizaciones</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cree clientes con plan y administrador inicial, o entre a una organización para usar el sistema como
            ella.
          </p>
          {user && !user.needsTenantSelection ? (
            <button
              type="button"
              className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              onClick={() => navigate('/dashboard', { replace: true })}
            >
              Ir al panel principal
            </button>
          ) : null}
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Nueva organización</h2>
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={handleCreate}>
            <label className="sm:col-span-2 block text-sm">
              <span className="text-slate-600">Nombre del cliente</span>
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.client_name}
                onChange={(ev) => setForm((f) => ({ ...f, client_name: ev.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Plan</span>
              <select
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.plan_id}
                onChange={(ev) => setForm((f) => ({ ...f, plan_id: ev.target.value }))}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Correo del administrador</span>
              <input
                required
                type="email"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.admin_email}
                onChange={(ev) => setForm((f) => ({ ...f, admin_email: ev.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Contraseña inicial del administrador</span>
              <input
                required
                type="password"
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.admin_password}
                onChange={(ev) => setForm((f) => ({ ...f, admin_password: ev.target.value }))}
              />
              <PasswordPolicyHint className="mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Nombre</span>
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.admin_first_name}
                onChange={(ev) => setForm((f) => ({ ...f, admin_first_name: ev.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Primer apellido</span>
              <input
                required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.admin_last_name_1}
                onChange={(ev) => setForm((f) => ({ ...f, admin_last_name_1: ev.target.value }))}
              />
            </label>
            <label className="sm:col-span-2 block text-sm">
              <span className="text-slate-600">Segundo apellido (opcional)</span>
              <input
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                value={form.admin_last_name_2}
                onChange={(ev) => setForm((f) => ({ ...f, admin_last_name_2: ev.target.value }))}
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creating || !plans.length}
                className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-60"
              >
                {creating ? 'Creando…' : 'Crear organización'}
              </button>
              {!plans.length ? (
                <p className="mt-2 text-xs text-amber-800">No hay planes en el sistema. Cree al menos un plan en la base de datos.</p>
              ) : null}
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Organizaciones</h2>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando…</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {clients.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <div className="font-medium text-slate-800">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      Plan: {c.plan_name || '—'} · Estado: {c.status || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-lime-700 px-3 py-1.5 text-sm font-medium text-lime-800 hover:bg-lime-50"
                    onClick={() => handleEnter(c.id)}
                  >
                    Entrar como esta organización
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
