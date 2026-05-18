import { isOfflineSupportedGet } from './offlineConfig.js';
import { getOfflineTenantSegmentForCache } from './offlineCacheScope.js';

const KEY_PREFIX_ROOT = 'wardi:api-get:v2:';
const MAX_ENTRIES = 250;

function storageKey(path) {
  return `${KEY_PREFIX_ROOT}${getOfflineTenantSegmentForCache()}:${path}`;
}

export function readApiGetCache(path) {
  if (!isOfflineSupportedGet(path)) return null;
  try {
    const raw = localStorage.getItem(storageKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeApiGetCache(path, data) {
  if (!isOfflineSupportedGet(path)) return;
  try {
    pruneIfNeeded();
    localStorage.setItem(
      storageKey(path),
      JSON.stringify({ data, cachedAt: Date.now() }),
    );
  } catch {
    /* quota or private mode */
  }
}

function pruneIfNeeded() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX_ROOT)) keys.push(k);
    }
    if (keys.length < MAX_ENTRIES) return;
    const dated = keys.map((k) => {
      try {
        const raw = localStorage.getItem(k);
        const parsed = raw ? JSON.parse(raw) : null;
        return { k, at: Number(parsed?.cachedAt) || 0 };
      } catch {
        return { k, at: 0 };
      }
    });
    dated.sort((a, b) => a.at - b.at);
    const remove = dated.length - MAX_ENTRIES + 20;
    for (let i = 0; i < remove; i += 1) {
      localStorage.removeItem(dated[i].k);
    }
  } catch {
    /* ignore */
  }
}
