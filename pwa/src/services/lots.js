import { apiRequest } from './api.js';
import { getOfflineTenantSegmentForCache } from '../offline/offlineCacheScope.js';

function lotsListCacheKey(farmId, includeInactive) {
  const f = farmId || '';
  return `lots:list:cache:v1:${getOfflineTenantSegmentForCache()}:${f}:${includeInactive ? '1' : '0'}`;
}

function saveListCache(farmId, includeInactive, payload) {
  try {
    localStorage.setItem(lotsListCacheKey(farmId, includeInactive), JSON.stringify(payload));
  } catch {
    // Best effort cache.
  }
}

function readListCache(farmId, includeInactive) {
  try {
    const raw = localStorage.getItem(lotsListCacheKey(farmId, includeInactive));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listLots({ farmId, includeInactive = false } = {}) {
  const params = new URLSearchParams();
  if (farmId) params.set('farm_id', farmId);
  if (includeInactive) params.set('include_inactive', 'true');
  const qs = params.toString();
  const path = `/api/lots${qs ? `?${qs}` : ''}`;

  try {
    const rows = await apiRequest(path);
    saveListCache(farmId || null, !!includeInactive, {
      rows,
      farmId: farmId || null,
      includeInactive: !!includeInactive,
      cachedAt: Date.now(),
    });
    return rows;
  } catch (e) {
    const cached = readListCache(farmId || null, !!includeInactive);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline && cached) {
      const sameFarm = (cached.farmId || null) === (farmId || null);
      const sameInactive = !!cached.includeInactive === !!includeInactive;
      if (sameFarm && sameInactive && Array.isArray(cached.rows)) {
        return cached.rows;
      }
    }
    throw e;
  }
}

export function getLotById(lotId) {
  return apiRequest(`/api/lots/${lotId}`);
}

export function createLot(payload) {
  return apiRequest('/api/lots', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateLot(lotId, payload) {
  return apiRequest(`/api/lots/${lotId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setLotActive(lotId, isActive) {
  return apiRequest(`/api/lots/${lotId}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

export function getLotsMeta() {
  return apiRequest('/api/lots/meta');
}

