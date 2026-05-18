import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createTenantUser,
  getTenantUsersMeta,
  listTenantUsers,
  setTenantUserActive,
  updateTenantUser,
} from '../../services/tenantUsersApi.js';
import PasswordPolicyHint from '../../components/PasswordPolicyHint.jsx';
import { validatePasswordPolicy } from '../../utils/passwordPolicy.js';

const EMPTY_FORM = {
  email: '',
  password: '',
  first_name: '',
  last_name_1: '',
  last_name_2: '',
  phone_1: '',
  phone_2: '',
  id_type: 'nacional',
  id_number: '',
  role: 'operario',
};

function fmtRole(r) {
  const x = String(r || '').toLowerCase();
  if (x === 'admin') return 'Administrador';
  if (x === 'operario') return 'Operario';
  return r || '—';
}

export default function UsersManagementPage() {
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [m, list] = await Promise.all([
        getTenantUsersMeta(),
        listTenantUsers({
          active: activeFilter === 'all' ? 'all' : activeFilter === 'active',
        }),
      ]);
      setMeta(m);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar los usuarios.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const quotaText = useMemo(() => {
    if (!meta) return '';
    const a = `${meta.active_admin_count ?? 0} / ${meta.max_users_admin ?? '—'}`;
    const o = `${meta.active_operario_count ?? 0} / ${meta.max_users_operario ?? '—'}`;
    return `Administradores: ${a} · Operarios: ${o} (según plan)`;
  }, [meta]);

  function openCreate() {
    setModal('create');
    setForm(EMPTY_FORM);
    setModalError('');
  }

  function openEdit(row) {
    setModal('edit');
    setModalError('');
    setForm({
      email: row.email || '',
      password: '',
      first_name: row.first_name || '',
      last_name_1: row.last_name_1 || '',
      last_name_2: row.last_name_2 || '',
      phone_1: row.phone_1 || '',
      phone_2: row.phone_2 || '',
      id_type: row.id_type || 'nacional',
      id_number: row.id_number || '',
      role: String(row.role || 'operario').toLowerCase(),
      _id: row.id,
    });
  }

  function closeModal() {
    if (saving) return;
    setModal(null);
    setModalError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setModalError('');
    if (modal === 'create' || (modal === 'edit' && form.password.trim())) {
      const policyErr = validatePasswordPolicy(form.password);
      if (policyErr) {
        setModalError(policyErr);
        return;
      }
    }
    setSaving(true);
    try {
      if (modal === 'create') {
        await createTenantUser({
          email: form.email.trim(),
          password: form.password,
          first_name: form.first_name.trim(),
          last_name_1: form.last_name_1.trim(),
          last_name_2: form.last_name_2.trim() || undefined,
          phone_1: form.phone_1.trim() || undefined,
          phone_2: form.phone_2.trim() || undefined,
          id_type: form.id_type,
          id_number: form.id_number.trim(),
          role: form.role,
        });
      } else if (modal === 'edit' && form._id) {
        const payload = {
          email: form.email.trim(),
          first_name: form.first_name.trim(),
          last_name_1: form.last_name_1.trim(),
          last_name_2: form.last_name_2.trim() || undefined,
          phone_1: form.phone_1.trim() || undefined,
          phone_2: form.phone_2.trim() || undefined,
          id_type: form.id_type,
          id_number: form.id_number.trim(),
          role: form.role,
        };
        if (form.password.trim()) {
          payload.password = form.password;
        }
        await updateTenantUser(form._id, payload);
      }
      closeModal();
      await loadAll();
    } catch (err) {
      setModalError(err?.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row) {
    const next = !row.is_active;
    const verb = next ? 'reactivar' : 'inactivar';
    if (!window.confirm(`¿${verb} a ${row.email}?`)) return;
    setError('');
    try {
      await setTenantUserActive(row.id, next);
      await loadAll();
    } catch (err) {
      setError(err?.message || 'No se pudo actualizar el estado.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-lime-800">Gestión de usuarios</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Cree y administre usuarios del cliente según los cupos del plan. El correo no puede repetirse entre
            usuarios <strong>activos</strong> de distintos clientes; un usuario inactivo puede compartir correo con
            otro cliente, pero no podrá reactivarse si ya existe un activo con ese correo.
          </p>
          {quotaText ? <p className="mt-2 text-xs text-slate-500">{quotaText}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600">
            Estado:{' '}
            <select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="all">Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
          </label>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-lime-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-lime-800"
          >
            Nuevo usuario
          </button>
          <Link to="/dashboard" className="text-sm text-lime-800 underline">
            Volver al panel
          </Link>
        </div>
      </div>

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">Correo</th>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Identificación</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No hay usuarios con este filtro.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2 font-medium">{r.email}</td>
                    <td className="px-3 py-2">
                      {[r.first_name, r.last_name_1, r.last_name_2].filter(Boolean).join(' ')}
                    </td>
                    <td className="px-3 py-2">{fmtRole(r.role)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {r.id_type} {r.id_number}
                    </td>
                    <td className="px-3 py-2">{r.is_active ? 'Activo' : 'Inactivo'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="text-xs font-semibold text-sky-800 underline"
                        onClick={() => openEdit(r)}
                      >
                        Editar
                      </button>
                      <span className="mx-1 text-slate-300">|</span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-amber-800 underline"
                        onClick={() => toggleActive(r)}
                      >
                        {r.is_active ? 'Inactivar' : 'Reactivar'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold text-slate-900">
              {modal === 'create' ? 'Nuevo usuario' : 'Editar usuario'}
            </h2>
            <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Correo *</span>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">
                  {modal === 'create' ? 'Contraseña *' : 'Nueva contraseña (opcional)'}
                </span>
                <input
                  type="password"
                  required={modal === 'create'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
                <PasswordPolicyHint className="mt-1" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Nombre *</span>
                <input
                  required
                  value={form.first_name}
                  onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Primer apellido *</span>
                <input
                  required
                  value={form.last_name_1}
                  onChange={(e) => setForm((f) => ({ ...f, last_name_1: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Segundo apellido</span>
                <input
                  value={form.last_name_2}
                  onChange={(e) => setForm((f) => ({ ...f, last_name_2: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Teléfono 1</span>
                  <input
                    value={form.phone_1}
                    onChange={(e) => setForm((f) => ({ ...f, phone_1: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Teléfono 2</span>
                  <input
                    value={form.phone_2}
                    onChange={(e) => setForm((f) => ({ ...f, phone_2: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Tipo ID *</span>
                  <select
                    value={form.id_type}
                    onChange={(e) => setForm((f) => ({ ...f, id_type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  >
                    <option value="nacional">Nacional</option>
                    <option value="extranjero">Extranjero</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Número ID *</span>
                  <input
                    required
                    value={form.id_number}
                    onChange={(e) => setForm((f) => ({ ...f, id_number: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </label>
              </div>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Rol *</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  <option value="admin">Administrador</option>
                  <option value="operario">Operario</option>
                </select>
              </label>
              {modalError ? <p className="text-sm text-rose-700">{modalError}</p> : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
