import { listMutations, removeMutation } from './mutationQueue.js';
import { listPendingJobs, removePendingJob } from './expensesSyncStore.js';

/**
 * Quita solo la entrada que falló al sincronizar (detalle emitido por la cola).
 * @param {{ source?: string, jobId?: number, expenseNamespace?: string }} detail
 */
export async function discardFromSyncFailureDetail(detail) {
  if (!detail) return;
  if (detail.expenseNamespace != null && detail.jobId != null) {
    await removePendingJob(detail.expenseNamespace, detail.jobId);
    return;
  }
  if (detail.jobId != null) {
    await removeMutation(detail.jobId);
  }
}

/** Vacía cola genérica + colas de gastos (solo copia local pendiente). */
export async function discardAllPendingOfflineJobs() {
  const mutations = await listMutations();
  for (const j of mutations) {
    await removeMutation(j.id);
  }
  for (const ns of ['lot_expenses', 'general_expenses']) {
    const jobs = await listPendingJobs(ns);
    for (const j of jobs) {
      await removePendingJob(ns, j.id);
    }
  }
}
