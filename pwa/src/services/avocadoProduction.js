import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function getAvocadoProductionMeta() {
  return apiRequest('/api/avocado-production/meta');
}

export function listAvocadoProduction(filters = {}) {
  return apiRequest(`/api/avocado-production${toQuery(filters)}`);
}

export function getAvocadoProductionById(id) {
  return apiRequest(`/api/avocado-production/${id}`);
}

export function createAvocadoProduction(payload) {
  return apiRequest('/api/avocado-production', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createAvocadoProductionBulk(payload) {
  return apiRequest('/api/avocado-production/bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAvocadoProduction(id, payload) {
  return apiRequest(`/api/avocado-production/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setAvocadoProductionActive(id, isActive) {
  return apiRequest(`/api/avocado-production/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

export function getAvocadoProductionSummaryByLot(filters = {}) {
  return apiRequest(`/api/avocado-production/summary/lot${toQuery(filters)}`);
}

