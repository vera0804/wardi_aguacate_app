export function crc(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const x = Math.round(Number(n) * 100) / 100;
  const cents = Math.round(x * 100);
  const isWholeColones = cents % 100 === 0;
  return `₡${x.toLocaleString(
    'es-CR',
    isWholeColones ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  )}`;
}

export function num(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('es-CR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 89);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function TableWrap({ children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
      <table className="w-full min-w-[720px] text-sm">{children}</table>
    </div>
  );
}
