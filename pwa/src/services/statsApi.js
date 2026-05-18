import { apiRequest } from './api.js';

/**
 * @param {{ from?: string, to?: string, farmId?: string|null, lotId?: string|null, lowStockThreshold?: number }} opts
 */
export async function fetchStatsOverview(opts = {}) {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.farmId) params.set('farm_id', opts.farmId);
  if (opts.lotId) params.set('lot_id', opts.lotId);
  if (opts.lowStockThreshold != null && opts.lowStockThreshold !== '') {
    params.set('low_stock_threshold', String(opts.lowStockThreshold));
  }
  const q = params.toString();
  return apiRequest(`/api/stats/overview${q ? `?${q}` : ''}`);
}
