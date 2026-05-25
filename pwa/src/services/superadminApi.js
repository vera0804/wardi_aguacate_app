import { apiRequest } from './api.js';

export function fetchSuperadminPlans() {
  return apiRequest('/api/superadmin/plans');
}

export function fetchSuperadminPlansAll() {
  return apiRequest('/api/superadmin/plans/all');
}

export function fetchSuperadminPlanImpact(planId) {
  return apiRequest(`/api/superadmin/plans/${planId}/impact`);
}

export function createSuperadminPlan(payload) {
  return apiRequest('/api/superadmin/plans', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSuperadminPlan(planId, payload) {
  return apiRequest(`/api/superadmin/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deactivateSuperadminPlan(planId, { acknowledge_affected_clients = false } = {}) {
  return apiRequest(`/api/superadmin/plans/${planId}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ acknowledge_affected_clients }),
  });
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

export function renewSuperadminClientLicense(clientId, payload) {
  return apiRequest(`/api/superadmin/clients/${clientId}/license/renew`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
