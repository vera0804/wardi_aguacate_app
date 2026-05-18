import { apiRequest } from './api.js';

export function getTenantUsersMeta() {
  return apiRequest('/api/tenant-users/meta');
}

export function listTenantUsers({ active } = {}) {
  const qs = new URLSearchParams();
  if (active === true) qs.set('active', 'true');
  else if (active === false) qs.set('active', 'false');
  else if (active === 'all') qs.set('active', 'all');
  const q = qs.toString();
  return apiRequest(`/api/tenant-users${q ? `?${q}` : ''}`);
}

export function createTenantUser(payload) {
  return apiRequest('/api/tenant-users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTenantUser(id, payload) {
  return apiRequest(`/api/tenant-users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setTenantUserActive(id, isActive) {
  return apiRequest(`/api/tenant-users/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  });
}
