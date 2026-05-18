import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../services/api.js';
import PasswordPolicyHint from '../components/PasswordPolicyHint.jsx';
import { MIN_PASSWORD_LEN, validatePasswordPolicy } from '../utils/passwordPolicy.js';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = useMemo(() => searchParams.get('token')?.trim() || '', [searchParams]);

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiRequest('/api/auth/csrf').catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    const policyErr = validatePasswordPolicy(newPassword);
    if (policyErr) {
      setError(policyErr);
      return;
    }
    setLoading(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: tokenFromUrl, new_password: newPassword }),
      });
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err?.message || 'No se pudo restablecer la contraseña.');
    } finally {
      setLoading(false);
    }
  }

  if (!tokenFromUrl) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-lime-50 via-amber-50/40 to-lime-100/80 px-4 py-10">
        <div className="w-full max-w-sm rounded-2xl border border-amber-200/80 bg-white/95 p-6 text-center shadow-md sm:p-8">
          <h1 className="text-lg font-semibold text-lime-950">Enlace inválido</h1>
          <p className="mt-2 text-sm text-lime-900/80">
            Falta el token de recuperación o el enlace está incompleto. Solicite un nuevo enlace desde la pantalla de
            acceso.
          </p>
          <Link
            to="/olvidaste-contrasena"
            className="mt-6 inline-block text-sm font-medium text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950"
          >
            Solicitar recuperación
          </Link>
          <div className="mt-3">
            <Link to="/login" className="text-sm text-lime-700 hover:underline">
              Volver al inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-lime-50 via-amber-50/40 to-lime-100/80 px-4 py-10">
        <div className="w-full max-w-sm rounded-2xl border border-lime-200/80 bg-white/95 p-6 text-center shadow-md sm:p-8">
          <p className="text-sm font-medium text-lime-950">Contraseña actualizada. Redirigiendo al inicio de sesión…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-lime-50 via-amber-50/40 to-lime-100/80 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-lime-200/80 bg-white/95 p-6 shadow-md shadow-lime-900/5 sm:p-8">
        <header className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-lime-950">Nueva contraseña</h1>
          <PasswordPolicyHint className="mt-2 text-lime-900/80" />
        </header>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-new" className="text-sm font-medium text-lime-950">
              Nueva contraseña
            </label>
            <input
              id="reset-new"
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={MIN_PASSWORD_LEN}
              className="rounded-lg border border-lime-200 bg-white px-3 py-2 text-lime-950 outline-none ring-lime-400/40 focus:ring-2"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="reset-confirm" className="text-sm font-medium text-lime-950">
              Confirmar contraseña
            </label>
            <input
              id="reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={MIN_PASSWORD_LEN}
              className="rounded-lg border border-lime-200 bg-white px-3 py-2 text-lime-950 outline-none ring-lime-400/40 focus:ring-2"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-lime-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-lime-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Guardando…' : 'Guardar contraseña'}
          </button>

          <Link
            to="/login"
            className="text-center text-sm font-medium text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950"
          >
            Volver al inicio de sesión
          </Link>
        </form>
      </div>
    </div>
  );
}
