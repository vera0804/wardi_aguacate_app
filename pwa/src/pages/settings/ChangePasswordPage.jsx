import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../services/api.js';
import { DASHBOARD_MENU_STORAGE_KEY } from '../../layouts/dashboardMenuData.js';
import PasswordPolicyHint from '../../components/PasswordPolicyHint.jsx';
import { MIN_PASSWORD_LEN, validatePasswordPolicy } from '../../utils/passwordPolicy.js';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  function goBackToSettings() {
    try {
      sessionStorage.setItem(DASHBOARD_MENU_STORAGE_KEY, 'Configuración');
    } catch {
      /* ignore */
    }
    navigate('/dashboard');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    const policyErr = validatePasswordPolicy(newPassword);
    if (policyErr) {
      setError(policyErr);
      return;
    }
    setSaving(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setSuccess('Contraseña actualizada. Las demás sesiones de este usuario se cerraron.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err?.message || 'No se pudo cambiar la contraseña.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <button
          type="button"
          onClick={goBackToSettings}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          ← Volver a Configuración
        </button>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-lime-800">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-slate-600">Indique su contraseña actual y la nueva.</p>
        <PasswordPolicyHint className="mt-1" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        ) : null}
        {success ? (
          <p className="rounded-lg border border-lime-200 bg-lime-50 px-3 py-2 text-sm text-lime-900">{success}</p>
        ) : null}

        <label className="block text-sm font-medium text-slate-700">
          Contraseña actual
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(ev) => setCurrentPassword(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600"
            required
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Nueva contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(ev) => setNewPassword(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600"
            required
            minLength={MIN_PASSWORD_LEN}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Confirmar nueva contraseña
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(ev) => setConfirmPassword(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-lime-600 focus:outline-none focus:ring-1 focus:ring-lime-600"
            required
            minLength={MIN_PASSWORD_LEN}
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg bg-lime-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-lime-800 disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar nueva contraseña'}
        </button>
      </form>
    </div>
  );
}
