import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function listMixApplications(filters = {}) {
  return apiRequest(`/api/mix-applications${toQuery(filters)}`);
}

export function getMixApplication(id) {
  return apiRequest(`/api/mix-applications/${encodeURIComponent(id)}`);
}

export function deactivateMixApplication(id) {
  return apiRequest(`/api/mix-applications/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
}

export function createMixApplication(payload) {
  return apiRequest('/api/mix-applications', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
