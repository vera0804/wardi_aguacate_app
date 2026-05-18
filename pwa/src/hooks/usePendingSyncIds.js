import { useCallback, useEffect, useState } from 'react';
import { countPending, listPendingJobs, removePendingJob } from '../offline/expensesSyncStore.js';

/**
 * @param {'lot_expenses' | 'general_expenses'} namespace
 * @param {{ flush?: () => Promise<void> }} options
 */
export function usePendingSyncIds(namespace, { flush } = {}) {
  const [pendingCount, setPendingCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setPendingCount(await countPending(namespace));
    } catch {
      setPendingCount(0);
    }
  }, [namespace]);

  useEffect(() => {
    refresh();
    function onOnline() {
      refresh();
      if (typeof flush === 'function' && navigator.onLine) {
        flush().catch(() => {});
      }
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh, flush]);

  return {
    pendingCount,
    refresh,
    listPendingJobs: () => listPendingJobs(namespace),
    removePendingJob: (id) => removePendingJob(namespace, id),
  };
}
