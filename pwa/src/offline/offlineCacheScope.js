/**
 * Aísla caché offline (localStorage + Cache API) por contexto de organización / sesión
 * y purga al cambiar de tenant o cerrar sesión.
 */

export const OFFLINE_TENANT_SESSION_KEY = 'wardi_cache_tenant_seg';

function tenantSegmentFromUser(user) {
  if (!user || typeof user !== 'object') return 'anon';
  const id =
    user.clientId ||
    user.client_id ||
    user.actingClientId ||
    user.acting_client_id ||
    user.homeClientId ||
    user.home_client_id;
  if (id != null && String(id).trim()) return String(id).trim();
  return 'anon';
}

export async function syncOfflineCacheContext(user) {
  if (typeof window === 'undefined') return;

  if (!user) {
    await purgeWardiOfflineDataStores();
    try {
      sessionStorage.removeItem(OFFLINE_TENANT_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return;
  }

  const next = tenantSegmentFromUser(user);
  let prev = null;
  try {
    prev = sessionStorage.getItem(OFFLINE_TENANT_SESSION_KEY);
  } catch {
    prev = null;
  }

  if (prev != null && prev !== next) {
    await purgeWardiOfflineDataStores();
  }

  try {
    sessionStorage.setItem(OFFLINE_TENANT_SESSION_KEY, next);
  } catch {
    /* ignore */
  }
}

export function getOfflineTenantSegmentForCache() {
  if (typeof sessionStorage === 'undefined') return 'anon';
  try {
    return sessionStorage.getItem(OFFLINE_TENANT_SESSION_KEY) || 'anon';
  } catch {
    return 'anon';
  }
}

export async function purgeWardiOfflineDataStores() {
  try {
    if (typeof localStorage !== 'undefined') {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (
          k &&
          (k.startsWith('wardi:api-get:v1:') ||
            k.startsWith('wardi:api-get:v2:') ||
            k.startsWith('farms:list:cache:') ||
            k.startsWith('lots:list:cache:'))
        ) {
          keys.push(k);
        }
      }
      keys.forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    /* ignore */
  }

  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.includes('wardi-api') || n.startsWith('wardi-'))
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    /* ignore */
  }
}
