import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function listCalendarActivities(params = {}) {
  return apiRequest(`/api/calendar-activities${toQuery(params)}`);
}

export function getCalendarActivity(id) {
  return apiRequest(`/api/calendar-activities/${id}`);
}

export function createCalendarActivity(payload) {
  return apiRequest('/api/calendar-activities', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateCalendarActivity(id, payload) {
  return apiRequest(`/api/calendar-activities/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}
