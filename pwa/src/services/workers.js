import { apiRequest } from './api.js';

export function listWorkers({ active = 'true', type, search } = {}) {
  const params = new URLSearchParams();
  if (active) params.set('active', active);
  if (type) params.set('type', type);
  if (search) params.set('search', search);
  const qs = params.toString();
  return apiRequest(`/api/workers${qs ? `?${qs}` : ''}`);
}

export function getWorkerById(workerId) {
  return apiRequest(`/api/workers/${workerId}`);
}

export function createWorker(payload) {
  return apiRequest('/api/workers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateWorker(workerId, payload) {
  return apiRequest(`/api/workers/${workerId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setWorkerActive(workerId, isActive) {
  return apiRequest(`/api/workers/${workerId}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

