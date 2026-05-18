import { useEffect } from 'react';
import { flushAllOfflineSync } from '../offline/flushOfflineSync.js';

/** Al volver en línea, sincroniza colas pendientes. */
export function useOfflineSync() {
  useEffect(() => {
    function onOnline() {
      flushAllOfflineSync().catch(() => {});
    }
    window.addEventListener('online', onOnline);
    if (navigator.onLine) {
      flushAllOfflineSync().catch(() => {});
    }
    return () => window.removeEventListener('online', onOnline);
  }, []);
}
