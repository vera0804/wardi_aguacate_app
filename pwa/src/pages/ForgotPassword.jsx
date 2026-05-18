import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../services/api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    apiRequest('/api/auth/csrf').catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('/api/auth/request-password-reset', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSent(true);
    } catch (err) {
      const msg = err?.message || 'No se pudo enviar la solicitud.';
      setError(
        `${msg} Si el problema persiste, verifique que el servidor tenga configurado el envío de correo (Resend).`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-lime-50 via-amber-50/40 to-lime-100/80 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-lime-200/80 bg-white/95 p-6 shadow-md shadow-lime-900/5 sm:p-8">
        <header className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-lime-950">Recuperar contraseña</h1>
          <p className="mt-2 text-sm text-lime-900/80">
            Escriba el correo de su cuenta. Si existe, recibirá un enlace para definir una nueva contraseña.
          </p>
        </header>

        {sent ? (
          <div className="space-y-4 text-sm text-lime-950">
            <p className="rounded-lg border border-lime-200 bg-lime-50/90 px-3 py-3 leading-relaxed">
              Si existe una cuenta con ese correo, recibirá un enlace para restablecer la contraseña. Revise también la
              carpeta de spam.
            </p>
            <Link
              to="/login"
              className="block text-center text-sm font-medium text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950"
            >
              Volver al inicio de sesión
            </Link>
          </div>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="forgot-email" className="text-sm font-medium text-lime-950">
                Correo electrónico
              </label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {loading ? 'Enviando…' : 'Enviar enlace'}
            </button>

            <Link
              to="/login"
              className="text-center text-sm font-medium text-lime-800 underline decoration-lime-300 underline-offset-2 hover:text-lime-950"
            >
              Volver al inicio de sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
