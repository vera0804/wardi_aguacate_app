import { apiRequest, isNetworkFailure } from '../services/api.js';import { listMutations, removeMutation } from './mutationQueue.js';
import { listPendingJobs, removePendingJob } from './expensesSyncStore.js';
import { reportOfflineSyncFailure } from './offlineSyncAlerts.js';
import {
  createExpense,
  updateExpense,
  setExpenseActive,
  createGeneralExpense,
  updateGeneralExpense,
  setGeneralExpenseActive,
} from '../services/expensesApi.js';

async function flushExpenseNamespace(namespace) {
  const jobs = await listPendingJobs(namespace);
  for (const job of jobs) {
    const p = job.payload;
    try {
      if (namespace === 'lot_expenses') {
        if (p.kind === 'create') await createExpense(p.body);
        else if (p.kind === 'update') await updateExpense(p.id, p.body);
        else if (p.kind === 'active') await setExpenseActive(p.id, p.is_active);
      } else if (namespace === 'general_expenses') {
        if (p.kind === 'create') await createGeneralExpense(p.body);
        else if (p.kind === 'update') await updateGeneralExpense(p.id, p.body);
        else if (p.kind === 'active') await setGeneralExpenseActive(p.id, p.is_active);
      }
      await removePendingJob(namespace, job.id);
    } catch (e) {
      if (!navigator.onLine || isNetworkFailure(e)) break;
      reportOfflineSyncFailure({
        source: 'expense',
        expenseNamespace: namespace,
        jobId: job.id,
        message: e?.message || String(e),
        status: e?.status,
      });
      break;
    }
  }
}

export async function flushMutationQueue() {
  const jobs = await listMutations();
  for (const job of jobs) {
    try {
      await apiRequest(job.path, {
        method: job.method,
        body: job.body,
        headers: job.headers || undefined,
        skipOfflineQueue: true,
      });
      await removeMutation(job.id);
    } catch (e) {
      if (!navigator.onLine || isNetworkFailure(e)) break;
      reportOfflineSyncFailure({
        source: 'mutation',
        path: job.path,
        method: job.method,
        message: e?.message || String(e),
        status: e?.status,
        jobId: job.id,
      });
      break;
    }
  }
}

/** Sincroniza cola genérica + gastos al recuperar red. */
export async function flushAllOfflineSync() {
  if (!navigator.onLine) return;
  try {
    window.dispatchEvent(new CustomEvent('wardi-offline-sync-start'));
    await flushMutationQueue();
    await flushExpenseNamespace('lot_expenses');
    await flushExpenseNamespace('general_expenses');
  } finally {
    window.dispatchEvent(new CustomEvent('wardi-offline-sync-end'));
  }
}
