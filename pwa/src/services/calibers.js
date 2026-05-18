import { apiRequest } from './api.js';

export function listCalibers({ includeInactive = false, search = '' } = {}) {
  const params = new URLSearchParams();
  if (includeInactive) params.set('include_inactive', 'true');
  if (search) params.set('search', search);
  const qs = params.toString();
  return apiRequest(`/api/calibers${qs ? `?${qs}` : ''}`);
}

export function createCaliber(payload) {
  return apiRequest('/api/calibers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCaliber(caliberId, payload) {
  return apiRequest(`/api/calibers/${caliberId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setCaliberActive(caliberId, isActive) {
  return apiRequest(`/api/calibers/${caliberId}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

