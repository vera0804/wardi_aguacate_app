import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function getLaborEntriesMeta() {
  return apiRequest('/api/labor-entries/meta');
}

export function listLaborEntries(filters = {}) {
  return apiRequest(`/api/labor-entries${toQuery(filters)}`);
}

export function getLaborEntryById(id) {
  return apiRequest(`/api/labor-entries/${id}`);
}

export function createLaborEntry(payload) {
  return apiRequest('/api/labor-entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createLaborEntriesBulk(payload) {
  return apiRequest('/api/labor-entries/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateLaborEntry(id, payload) {
  return apiRequest(`/api/labor-entries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setLaborEntryActive(id, isActive) {
  return apiRequest(`/api/labor-entries/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

export function getLaborSummaryByLot(filters = {}) {
  return apiRequest(`/api/labor-entries/summary/lot${toQuery(filters)}`);
}

export function getLaborSummaryByWorker(filters = {}) {
  return apiRequest(`/api/labor-entries/summary/worker${toQuery(filters)}`);
}

