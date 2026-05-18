import { apiRequest } from './api.js';

export function listAguinaldoStatements({ worker_id, status, period_from, period_to } = {}) {
  const params = new URLSearchParams();
  if (worker_id) params.set('worker_id', worker_id);
  if (status !== undefined && status !== null && status !== '') params.set('status', status);
  if (period_from) params.set('period_from', period_from);
  if (period_to) params.set('period_to', period_to);
  const qs = params.toString();
  return apiRequest(`/api/aguinaldos${qs ? `?${qs}` : ''}`);
}

export function calculateAguinaldoStatement(payload) {
  return apiRequest('/api/aguinaldos/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function recalculateAguinaldoStatement(id) {
  return apiRequest(`/api/aguinaldos/${id}/recalculate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function updateAguinaldoStatementStatus(id, status) {
  return apiRequest(`/api/aguinaldos/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
