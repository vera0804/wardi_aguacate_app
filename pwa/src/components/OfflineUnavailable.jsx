import { OFFLINE_UNAVAILABLE_MESSAGE } from '../offline/offlineConfig.js';

export default function OfflineUnavailable({ fullPage = false }) {
  const inner = (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center text-sm text-amber-950 shadow-sm">
      <p className="font-medium">Sin conexión</p>
      <p className="mt-2 text-amber-900/90">{OFFLINE_UNAVAILABLE_MESSAGE}</p>
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="w-full max-w-md">{inner}</div>
      </div>
    );
  }

  return <div className="max-w-xl">{inner}</div>;
}
