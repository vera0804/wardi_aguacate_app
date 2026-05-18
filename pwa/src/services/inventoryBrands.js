import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function listInventoryBrands(filters = {}) {
  return apiRequest(`/api/inventory-brands${toQuery(filters)}`);
}

export function createInventoryBrand(payload) {
  return apiRequest('/api/inventory-brands', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateInventoryBrand(id, payload) {
  return apiRequest(`/api/inventory-brands/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setInventoryBrandActive(id, isActive) {
  return apiRequest(`/api/inventory-brands/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

