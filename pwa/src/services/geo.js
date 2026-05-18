import { apiRequest } from './api.js';

export function listProvinces() {
  return apiRequest('/api/geo/provinces');
}

export function listCantons(provinceId) {
  return apiRequest(`/api/geo/cantons?province_id=${encodeURIComponent(provinceId)}`);
}

export function listDistricts(cantonId) {
  return apiRequest(`/api/geo/districts?canton_id=${encodeURIComponent(cantonId)}`);
}
