import { apiRequest } from './api.js';
import { getOfflineTenantSegmentForCache } from '../offline/offlineCacheScope.js';

function farmsListCacheKey(includeInactive) {
  return `farms:list:cache:v1:${getOfflineTenantSegmentForCache()}:${includeInactive ? '1' : '0'}`;
}

function saveListCache(includeInactive, payload) {
  try {
    localStorage.setItem(farmsListCacheKey(includeInactive), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function readListCache(includeInactive) {
  try {
    const raw = localStorage.getItem(farmsListCacheKey(includeInactive));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listFarms({ includeInactive = false } = {}) {
  const q = includeInactive ? '?includeInactive=true' : '';
  const path = `/api/farms${q}`;

  try {
    const rows = await apiRequest(path);
    saveListCache(!!includeInactive, {
      rows,
      includeInactive: !!includeInactive,
      cachedAt: Date.now(),
    });
    return rows;
  } catch (e) {
    const cached = readListCache(!!includeInactive);
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline && cached && !!cached.includeInactive === !!includeInactive) {
      return Array.isArray(cached.rows) ? cached.rows : [];
    }
    throw e;
  }
}

export function createFarm(payload) {
  return apiRequest('/api/farms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateFarm(farmId, payload) {
  return apiRequest(`/api/farms/${farmId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function inactivateFarm(farmId) {
  return apiRequest(`/api/farms/${farmId}/inactivate`, { method: 'POST' });
}

export function activateFarm(farmId) {
  return apiRequest(`/api/farms/${farmId}/activate`, { method: 'POST' });
}
