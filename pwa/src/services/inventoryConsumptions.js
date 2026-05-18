import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function listInventoryConsumptions(filters = {}) {
  return apiRequest(`/api/inventory-consumptions${toQuery(filters)}`);
}

export function getInventoryConsumption(id) {
  return apiRequest(`/api/inventory-consumptions/${id}`);
}

export function createInventoryConsumption(payload) {
  return apiRequest('/api/inventory-consumptions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateInventoryConsumption(id, payload) {
  return apiRequest(`/api/inventory-consumptions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deactivateInventoryConsumption(id) {
  return apiRequest(`/api/inventory-consumptions/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
}
