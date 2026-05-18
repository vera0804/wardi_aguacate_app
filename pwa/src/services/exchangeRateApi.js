import { apiRequest } from './api.js';

/**
 * @param {{ date: string, kind?: 'venta'|'compra' }} opts
 * @returns {Promise<{ date: string, kind: string, rate: number, source: string, stale: boolean, warning: string | null }>}
 */
export async function fetchUsdBccr(opts) {
  const { date, kind = 'venta' } = opts;
  const q = new URLSearchParams({ date, kind });
  return apiRequest(`/api/exchange-rate/usd?${q}`);
}

/** Fecha local Costa Rica en YYYY-MM-DD (alinear con calendario en CR). */
export function todayCostaRicaIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
