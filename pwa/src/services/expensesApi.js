import { apiRequest } from './api.js';

function qs(params) {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : '';
}

export async function getExpensesMeta() {
  return apiRequest(`/api/expenses/meta`);
}

export async function listExpenses(params = {}) {
  return apiRequest(`/api/expenses${qs(params)}`);
}

export async function getExpense(id) {
  return apiRequest(`/api/expenses/${encodeURIComponent(id)}`);
}

export async function createExpense(body) {
  return apiRequest('/api/expenses', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateExpense(id, body) {
  return apiRequest(`/api/expenses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function setExpenseActive(id, isActive) {
  return apiRequest(`/api/expenses/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  });
}

export async function listGeneralExpenses(params = {}) {
  return apiRequest(`/api/general-expenses${qs(params)}`);
}

export async function getGeneralExpense(id) {
  return apiRequest(`/api/general-expenses/${encodeURIComponent(id)}`);
}

export async function listGeneralExpenseAllocations(expenseId) {
  return apiRequest(`/api/general-expenses/${encodeURIComponent(expenseId)}/allocations`);
}

export async function createGeneralExpense(body) {
  return apiRequest('/api/general-expenses', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateGeneralExpense(id, body) {
  return apiRequest(`/api/general-expenses/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export async function setGeneralExpenseActive(id, isActive) {
  return apiRequest(`/api/general-expenses/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  });
}

export async function seedGeneralExpenseAllocations(id) {
  return apiRequest(`/api/general-expenses/${encodeURIComponent(id)}/seed-allocations`, { method: 'POST' });
}

export async function listAllocationsByQuery(params) {
  return apiRequest(`/api/general-expense-allocations${qs(params)}`);
}

export async function patchAllocation(id, body) {
  return apiRequest(`/api/general-expense-allocations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
