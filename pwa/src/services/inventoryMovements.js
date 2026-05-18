import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function getInventoryMovementsMeta() {
  return apiRequest('/api/inventory-movements/meta');
}

export function listInventoryMovements(filters = {}) {
  return apiRequest(`/api/inventory-movements${toQuery(filters)}`);
}

export function getInventoryMovementById(id) {
  return apiRequest(`/api/inventory-movements/${id}`);
}

export function getInventoryMovementLayers(id) {
  return apiRequest(`/api/inventory-movements/${id}/layers`);
}

export function createInventoryMovement(payload) {
  return apiRequest('/api/inventory-movements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createInventoryAdjustment(payload) {
  return apiRequest('/api/inventory-movements/adjust', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateInventoryMovement(id, payload) {
  return apiRequest(`/api/inventory-movements/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setInventoryMovementActive(id, isActive) {
  return apiRequest(`/api/inventory-movements/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

export function listInventoryStock(filters = {}) {
  return apiRequest(`/api/inventory-movements/stock/list${toQuery(filters)}`);
}

export function getInventoryStockLayers(itemId, { onlyAvailable = false } = {}) {
  const q = onlyAvailable ? '?available=1' : '';
  return apiRequest(`/api/inventory-movements/stock/${itemId}/layers${q}`);
}

export function getInventoryStockTotal() {
  return apiRequest('/api/inventory-movements/stock/total');
}

