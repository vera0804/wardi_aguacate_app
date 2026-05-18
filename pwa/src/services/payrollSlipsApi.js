import { apiRequest } from './api.js';

export function listPayrollSlips({ worker_id, status, period_from, period_to } = {}) {
  const params = new URLSearchParams();
  if (worker_id) params.set('worker_id', worker_id);
  if (status !== undefined && status !== null && status !== '') params.set('status', status);
  if (period_from) params.set('period_from', period_from);
  if (period_to) params.set('period_to', period_to);
  const qs = params.toString();
  return apiRequest(`/api/payroll-slips${qs ? `?${qs}` : ''}`);
}

export function getPayrollSlip(id) {
  return apiRequest(`/api/payroll-slips/${id}`);
}

export function calculatePayrollSlip(payload) {
  return apiRequest('/api/payroll-slips/calculate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Body opcional: monthly_gross (fijo), receives_aguinaldo, declares_ccss */
export function recalculatePayrollSlip(id, body = {}) {
  return apiRequest(`/api/payroll-slips/${id}/recalculate`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updatePayrollSlipStatus(id, status) {
  return apiRequest(`/api/payroll-slips/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}
