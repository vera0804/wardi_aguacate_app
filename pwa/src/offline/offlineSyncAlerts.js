/** Eventos para avisos de errores al vaciar la cola offline (mutaciones genéricas o gastos). */

export const OFFLINE_SYNC_FAIL_EVENT = 'wardi-offline-sync-failed';

/**
 * @param {{ source?: 'mutation' | 'expense', path?: string, method?: string, message?: string, status?: number, jobId?: number, expenseNamespace?: string }} detail
 */
export function reportOfflineSyncFailure(detail) {
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_FAIL_EVENT, { detail: { ...detail } }));
  } catch {
    /* ignore */
  }
}

function summarizePath(path) {
  const p = String(path || '').split('?')[0];
  if (p.startsWith('/api/labor-entries')) return 'Registro de labores';
  if (p.startsWith('/api/workers')) return 'Trabajadores';
  if (p.startsWith('/api/farms')) return 'Fincas';
  if (p.startsWith('/api/lots')) return 'Lotes';
  if (p.startsWith('/api/inventory-movements')) return 'Inventario';
  if (p.startsWith('/api/inventory-items')) return 'Insumos';
  if (p.startsWith('/api/mix-applications')) return 'Aplicaciones';
  if (p.startsWith('/api/avocado-production')) return 'Producción de aguacate';
  if (p.startsWith('/api/expenses')) return 'Gastos por lote';
  if (p.startsWith('/api/general-expenses')) return 'Gastos generales';
  return p || 'Servidor';
}

/**
 * Etiqueta legible para mensajes del banner.
 * @param {{ source?: string, path?: string, method?: string, message?: string, status?: number }} d
 */
export function formatOfflineSyncFailure(d) {
  const where =
    d.source === 'expense'
      ? 'Gastos (cola)'
      : summarizePath(d.path);
  const verb = String(d.method || 'POST').toUpperCase();
  const msg =
    typeof d.message === 'string' && d.message.trim()
      ? d.message.trim()
      : 'No se pudo completar la solicitud.';
  return `${where} — ${verb}: ${msg}`;
}
