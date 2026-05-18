import { apiRequest } from './api.js';

export function listPayrollNominaContributionRules({ active = 'all' } = {}) {
  const params = new URLSearchParams();
  if (active !== undefined && active !== '') params.set('active', active);
  const qs = params.toString();
  return apiRequest(`/api/payroll-nomina-contribution-rules${qs ? `?${qs}` : ''}`);
}

export function createPayrollNominaContributionRule(payload) {
  return apiRequest('/api/payroll-nomina-contribution-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deactivatePayrollNominaContributionRule(id) {
  return apiRequest(`/api/payroll-nomina-contribution-rules/${id}/deactivate`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
}
