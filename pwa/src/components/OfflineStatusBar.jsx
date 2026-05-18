import { useCallback, useEffect, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { countMutations } from '../offline/mutationQueue.js';
import { countPending } from '../offline/expensesSyncStore.js';
import { flushAllOfflineSync } from '../offline/flushOfflineSync.js';
import {
  OFFLINE_SYNC_FAIL_EVENT,
  formatOfflineSyncFailure,
} from '../offline/offlineSyncAlerts.js';
import {
  discardAllPendingOfflineJobs,
  discardFromSyncFailureDetail,
} from '../offline/discardOfflineQueue.js';

export default function OfflineStatusBar() {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncFailure, setSyncFailure] = useState(null);

  const refreshPending = useCallback(async () => {
    try {
      const [m, lot, gen] = await Promise.all([
        countMutations(),
        countPending('lot_expenses'),
        countPending('general_expenses'),
      ]);
      setPending(m + lot + gen);
    } catch {
      setPending(0);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [m, lot, gen] = await Promise.all([
          countMutations(),
          countPending('lot_expenses'),
          countPending('general_expenses'),
        ]);
        if (!cancelled) setPending(m + lot + gen);
      } catch {
        if (!cancelled) setPending(0);
      }
    }
    tick();
    const id = window.setInterval(tick, 5000);
    window.addEventListener('online', tick);
    window.addEventListener('wardi-offline-sync-end', tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('online', tick);
      window.removeEventListener('wardi-offline-sync-end', tick);
    };
  }, [online]);

  useEffect(() => {
    function onFail(ev) {
      const d = ev.detail || {};
      setSyncFailure(d);
    }
    function onStart() {
      setSyncBusy(true);
    }
    function onEnd() {
      setSyncBusy(false);
      refreshPending();
    }
    window.addEventListener(OFFLINE_SYNC_FAIL_EVENT, onFail);
    window.addEventListener('wardi-offline-sync-start', onStart);
    window.addEventListener('wardi-offline-sync-end', onEnd);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_FAIL_EVENT, onFail);
      window.removeEventListener('wardi-offline-sync-start', onStart);
      window.removeEventListener('wardi-offline-sync-end', onEnd);
    };
  }, [refreshPending]);

  async function handleRetrySync() {
    setSyncFailure(null);
    try {
      await flushAllOfflineSync();
    } catch {
      /* flush interno ya reporta fallos puntuales */
    } finally {
      await refreshPending();
    }
  }

  async function handleDiscardFromFailure() {
    if (!syncFailure) return;
    if (
      !window.confirm(
        '¿Sacar este cambio de la cola? No se enviará al servidor y podés volver a cargarlo si hace falta.',
      )
    ) {
      return;
    }
    try {
      if (syncFailure.jobId != null || syncFailure.expenseNamespace != null) {
        await discardFromSyncFailureDetail(syncFailure);
      } else {
        await discardAllPendingOfflineJobs();
      }
    } catch {
      /* ignore */
    }
    setSyncFailure(null);
    await refreshPending();
  }

  async function handleDiscardAllPending() {
    if (pending <= 0) return;
    if (
      !window.confirm(
        `Se eliminarán ${pending} cambio(s) guardados para subir al servidor (solo en este dispositivo). Esta acción no se puede deshacer. ¿Continuar?`,
      )
    ) {
      return;
    }
    try {
      await discardAllPendingOfflineJobs();
    } catch {
      /* ignore */
    }
    setSyncFailure(null);
    await refreshPending();
  }

  useEffect(() => {
    if (online && pending === 0) setSyncFailure(null);
  }, [online, pending]);

  if (online && pending === 0) return null;

  const showFailure = online && syncFailure && pending > 0;

  return (
    <div
      className={`border-b px-6 py-2 text-center text-sm ${
        showFailure
          ? 'border-rose-200 bg-rose-50 text-rose-950'
          : online
            ? 'border-amber-200 bg-amber-50 text-amber-950'
            : 'border-slate-300 bg-slate-100 text-slate-800'
      }`}
    >
      {!online ? (
        <span>
          Modo sin conexión — Inventario, aplicaciones, producción, trabajadores, labores y gastos
          siguen disponibles con los datos ya cargados.
        </span>
      ) : showFailure ? (
        <div className="mx-auto flex max-w-3xl flex-col items-stretch gap-2 sm:flex-row sm:items-start sm:justify-center sm:text-left">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">No se pudo sincronizar un cambio guardado offline</p>
            <p className="mt-1 break-words text-rose-900/95">{formatOfflineSyncFailure(syncFailure)}</p>
            <p className="mt-1 text-xs text-rose-900/85">
              Revisá el conflicto (por ejemplo planilla cerrada para esa fecha). Podés reintentar cuando estés en línea,
              o usar «Descartar de la cola» si no querés subir este cambio.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:flex-col sm:pt-0.5">
            <button
              type="button"
              disabled={syncBusy || !navigator.onLine}
              onClick={handleRetrySync}
              className="rounded-lg bg-rose-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-900 disabled:opacity-60"
            >
              {syncBusy ? 'Sincronizando…' : 'Reintentar'}
            </button>
            <button
              type="button"
              disabled={syncBusy}
              onClick={handleDiscardFromFailure}
              className="rounded-lg border border-rose-400 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100 disabled:opacity-60"
            >
              Descartar de la cola
            </button>
            <button
              type="button"
              onClick={() => setSyncFailure(null)}
              className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-900 hover:bg-rose-100"
            >
              Cerrar aviso
            </button>
          </div>
        </div>
      ) : pending > 0 ? (
        <span className="inline-flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
          {syncBusy ? (
            `Sincronizando ${pending} cambio(s) pendiente(s)…`
          ) : (
            <>
              <span>Hay {pending} cambio(s) pendiente(s) de subir.</span>
              <button
                type="button"
                disabled={!navigator.onLine}
                onClick={handleRetrySync}
                className="font-medium underline underline-offset-2 hover:text-amber-900 disabled:no-underline disabled:opacity-60"
              >
                Sincronizar ahora
              </button>
              <span className="text-amber-800/80" aria-hidden>
                ·
              </span>
              <button
                type="button"
                disabled={syncBusy}
                onClick={handleDiscardAllPending}
                className="font-medium underline underline-offset-2 hover:text-amber-900 disabled:no-underline disabled:opacity-60"
              >
                Descartar todos
              </button>
            </>
          )}
        </span>
      ) : null}
    </div>
  );
}
