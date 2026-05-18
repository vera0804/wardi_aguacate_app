import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function getInventoryItemsMeta() {
  return apiRequest('/api/inventory-items/meta');
}

export function listInventoryItems(filters = {}) {
  return apiRequest(`/api/inventory-items${toQuery(filters)}`);
}

export function createInventoryItem(payload) {
  return apiRequest('/api/inventory-items', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateInventoryItem(id, payload) {
  return apiRequest(`/api/inventory-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setInventoryItemActive(id, isActive) {
  return apiRequest(`/api/inventory-items/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

