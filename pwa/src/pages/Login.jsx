import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

const LICENSE_MSG =
  'Tu licencia ha expirado. Contacta al administrador para renovar el acceso.';

export default function Login() {
  const { login, user, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (location.state?.licenseExpired) {
      setError(LICENSE_MSG);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (ready && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [ready, user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const profile = await login(identifier.trim(), password);
      if (profile.requiresContractAcceptance && profile.role === 'admin') {
        navigate('/admin/terminos', { replace: true });
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err?.message || 'No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-lime-50 via-amber-50/40 to-lime-100/80 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-lime-200/80 bg-white/95 p-6 shadow-md shadow-lime-900/5 sm:p-8">
        <header className="mb-6 flex flex-col items-center text-center">
          <img
            src="/images/logo.png"
            alt="Wardi"
            className="mb-4 h-32 w-auto object-contain"
          />
          <h1 className="text-balance text-lg font-semibold leading-snug text-lime-950">
            Sistema de Gestión de Fincas Aguacateras
          </h1>
        </header>

        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-identifier" className="text-sm font-medium text-lime-950">
              Correo electrónico
            </label>
            <input
              id="login-identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="rounded-lg border border-lime-200 bg-white px-3 py-2 text-lime-950 outline-none ring-lime-400/40 focus:ring-2"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="login-password" className="text-sm font-medium text-lime-950">
              Contraseña
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-lime-200 bg-white px-3 py-2 text-lime-950 outline-none ring-lime-400/40 focus:ring-2"
            />
          </div>

          <div className="flex justify-end">
            <Link
              to="/olvidaste-contrasena"
              className="text-sm font-medium text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-lime-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-lime-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
