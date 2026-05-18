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

export function listExpenseCategories(params = {}) {
  return apiRequest(`/api/expense-categories${qs(params)}`);
}

export function getExpenseCategory(id) {
  return apiRequest(`/api/expense-categories/${encodeURIComponent(id)}`);
}

export function createExpenseCategory(payload) {
  return apiRequest('/api/expense-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateExpenseCategory(id, payload) {
  return apiRequest(`/api/expense-categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setExpenseCategoryActive(id, isActive) {
  return apiRequest(`/api/expense-categories/${encodeURIComponent(id)}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive }),
  });
}
