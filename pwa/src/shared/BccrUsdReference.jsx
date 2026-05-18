import { useEffect, useState } from 'react';
import { fetchUsdBccr, todayCostaRicaIso } from '../services/exchangeRateApi.js';

function fmtRate(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function fmtDateEs(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Referencia visual del USD según BCCR (venta + compra del día en CR).
 */
export default function BccrUsdReference({ className = '' }) {
  const [state, setState] = useState({
    loading: true,
    date: '',
    venta: null,
    compra: null,
    stale: false,
    warning: null,
    err: null,
  });

  useEffect(() => {
    let cancelled = false;
    const date = todayCostaRicaIso();
    (async () => {
      try {
        const [rVenta, rCompra] = await Promise.all([
          fetchUsdBccr({ date, kind: 'venta' }).catch(() => null),
          fetchUsdBccr({ date, kind: 'compra' }).catch(() => null),
        ]);
        if (cancelled) return;
        if (!rVenta && !rCompra) {
          const offline = typeof navigator !== 'undefined' && !navigator.onLine;
          setState({
            loading: false,
            date,
            venta: null,
            compra: null,
            stale: false,
            warning: null,
            err: offline
              ? 'Sin conexión. Abrí Inventario o Gastos con red al menos una vez para guardar la referencia.'
              : 'No se pudo consultar el BCCR.',
          });
          return;
        }
        const stale = Boolean(
          (rVenta && rVenta.stale) ||
            (rCompra && rCompra.stale) ||
            (typeof navigator !== 'undefined' && !navigator.onLine),
        );
        const warning = rVenta?.warning || rCompra?.warning || null;
        setState({
          loading: false,
          date,
          venta: rVenta,
          compra: rCompra,
          stale,
          warning,
          err: null,
        });
      } catch (e) {
        if (cancelled) return;
        setState({
          loading: false,
          date,
          venta: null,
          compra: null,
          stale: false,
          warning: null,
          err: e?.message || 'No disponible',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.loading) {
    return (
      <div
        className={`rounded-lg border border-slate-200/80 bg-slate-50/90 px-3 py-1.5 text-xs text-slate-400 ${className}`}
        aria-busy="true"
      >
        USD (BCCR)…
      </div>
    );
  }

  if (state.err && !state.venta && !state.compra) {
    return (
      <div
        className={`rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs text-slate-500 ${className}`}
        title={state.err}
      >
        USD (BCCR): referencia no disponible
      </div>
    );
  }

  const titleParts = [];
  if (state.warning) titleParts.push(state.warning);
  if (state.stale) titleParts.push('Valor posiblemente desactualizado (caché).');

  return (
    <div
      className={`inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 rounded-lg border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white px-3 py-1.5 text-xs text-slate-600 shadow-sm ${className}`}
      title={titleParts.length ? titleParts.join(' ') : 'Referencia del Banco Central; el tipo usado en gastos puede editarse al registrar.'}
    >
      <span className="font-medium text-slate-700">USD (BCCR)</span>
      <span className="mx-1.5 text-slate-300" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        Venta ₡{fmtRate(state.venta?.rate)}
      </span>
      <span className="mx-1.5 text-slate-300" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        Compra ₡{fmtRate(state.compra?.rate)}
      </span>
      {state.date ? (
        <>
          <span className="mx-1.5 text-slate-300" aria-hidden>
            ·
          </span>
          <span className="text-slate-500">{fmtDateEs(state.date)}</span>
        </>
      ) : null}
    </div>
  );
}
