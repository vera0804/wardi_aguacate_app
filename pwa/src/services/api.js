import { readApiGetCache, writeApiGetCache } from '../offline/apiReadCache.js';
import { enqueueMutation } from '../offline/mutationQueue.js';
import {
  isOfflineSupportedGet,
  isOfflineSupportedMutation,
} from '../offline/offlineConfig.js';

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export const OFFLINE_QUEUED_MESSAGE =
  'Sin conexión: el cambio quedó en cola para sincronizar cuando vuelva la red.';

export const OFFLINE_NO_CACHE_MESSAGE =
  'Sin conexión y sin datos guardados. Conectate a la red y abrí este módulo al menos una vez.';

export function isNetworkFailure(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('networkerror');
}

/**
 * Petición JSON con cookies (sesión) y cabecera CSRF si el backend la expone en cookie.
 */
export async function apiRequest(path, options = {}) {
  const url = `${import.meta.env.VITE_API_URL ?? ''}${path}`;
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  };

  const body = options.body;
  if (body !== undefined && typeof body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let csrf =
    readCookie('csrf_token') ||
    readCookie('csrfToken') ||
    readCookie('XSRF-TOKEN');

  const method = String(options.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (
    method === 'GET' &&
    isOfflineSupportedGet(path) &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine
  ) {
    const cached = readApiGetCache(path);
    if (cached) return cached.data;
    const err = new Error(OFFLINE_NO_CACHE_MESSAGE);
    err.code = 'OFFLINE_NO_CACHE';
    throw err;
  }

  if (
    !options.skipOfflineQueue &&
    typeof navigator !== 'undefined' &&
    !navigator.onLine &&
    isOfflineSupportedMutation(path, method)
  ) {
    await enqueueMutation({ path, method, body, headers: { ...headers } });
    const err = new Error(OFFLINE_QUEUED_MESSAGE);
    err.code = 'OFFLINE_QUEUED';
    throw err;
  }

  // Si falta CSRF en una mutación, la solicitud GET /api/auth/csrf asegura la cookie.
  if (!csrf && needsCsrf) {
    await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    csrf =
      readCookie('csrf_token') ||
      readCookie('csrfToken') ||
      readCookie('XSRF-TOKEN');
  }

  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  let res;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch (fetchErr) {
    if (method === 'GET' && isOfflineSupportedGet(path)) {
      const cached = readApiGetCache(path);
      if (cached && (isNetworkFailure(fetchErr) || !navigator.onLine)) {
        return cached.data;
      }
    }
    if (
      !options.skipOfflineQueue &&
      isOfflineSupportedMutation(path, method) &&
      isNetworkFailure(fetchErr)
    ) {
      await enqueueMutation({ path, method, body, headers: { ...headers } });
      const err = new Error(OFFLINE_QUEUED_MESSAGE);
      err.code = 'OFFLINE_QUEUED';
      throw err;
    }
    throw fetchErr;
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    if (
      method === 'GET' &&
      isOfflineSupportedGet(path) &&
      typeof navigator !== 'undefined' &&
      !navigator.onLine
    ) {
      const cached = readApiGetCache(path);
      if (cached) return cached.data;
    }
    const msg =
      (data && (data.message || data.error)) ||
      `Error ${res.status}`;
    const err = new Error(
      typeof msg === 'string' ? msg : 'No se pudo completar la solicitud',
    );
    err.status = res.status;
    if (data !== null && typeof data === 'object') err.body = data;
    throw err;
  }

  if (method === 'GET' && isOfflineSupportedGet(path)) {
    writeApiGetCache(path, data);
  }

  return data;
}

export * from './assetsApi.js';
export * from './expenseCategoriesApi.js';
export * from './expensesApi.js';
