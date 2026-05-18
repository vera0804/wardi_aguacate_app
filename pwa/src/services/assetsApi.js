import { apiRequest } from './api.js';

function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const str = qs.toString();
  return str ? `?${str}` : '';
}

export function listAssetCategories(params = {}) {
  return apiRequest(`/api/asset-categories${toQuery(params)}`);
}

export function getAssetCategory(id) {
  return apiRequest(`/api/asset-categories/${id}`);
}

export function createAssetCategory(payload) {
  return apiRequest('/api/asset-categories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAssetCategory(id, payload) {
  return apiRequest(`/api/asset-categories/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function setAssetCategoryActive(id, isActive) {
  return apiRequest(`/api/asset-categories/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: !!isActive }),
  });
}

export function listAssets(params = {}) {
  return apiRequest(`/api/assets${toQuery(params)}`);
}

export function getAsset(id) {
  return apiRequest(`/api/assets/${id}`);
}

export function createAsset(payload) {
  return apiRequest('/api/assets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAsset(id, payload) {
  return apiRequest(`/api/assets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/** is_active false requiere disposition_reason, disposition_date; notas opcionales. */
export function setAssetActive(id, payload) {
  return apiRequest(`/api/assets/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listAssetDepreciation(params = {}) {
  return apiRequest(`/api/asset-depreciation${toQuery(params)}`);
}

export function calculateAssetDepreciation(assetId) {
  return apiRequest('/api/asset-depreciation/calculate', {
    method: 'POST',
    body: JSON.stringify({ asset_id: assetId }),
  });
}
