import { apiRequest } from './api.js';

export function fetchSuperadminPlans() {
  return apiRequest('/api/superadmin/plans');
}

export function fetchSuperadminClients() {
  return apiRequest('/api/superadmin/clients');
}

export function createSuperadminClient(payload) {
  return apiRequest('/api/superadmin/clients', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function superadminEnterTenant(clientId) {
  return apiRequest('/api/superadmin/session/tenant', {
    method: 'POST',
    body: JSON.stringify({ client_id: clientId }),
  });
}

export function superadminLeaveTenant() {
  return apiRequest('/api/superadmin/session/tenant', {
    method: 'DELETE',
  });
}
