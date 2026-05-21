import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchUsdBccr, todayCostaRicaIso } from '../services/exchangeRateApi.js';

function resolveReferenceDate(refDate) {
  const d = String(refDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return todayCostaRicaIso();
}

/**
 * Campo de tipo de cambio CRC/USD con opción de rellenar venta BCCR del día (o fecha de referencia).
 */
export default function FxRateUsdField({
  value,
  onChange,
  referenceDate,
  required = false,
  label = 'Tipo de cambio (CRC por USD)',
  compact = false,
  inputClassName,
  placeholder,
}) {
  const [useBccr, setUseBccr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const applyBccr = useCallback(async (dateIso) => {
    setLoading(true);
    setFetchErr('');
    try {
      const r = await fetchUsdBccr({ date: dateIso, kind: 'venta' });
      if (r?.rate != null && Number.isFinite(Number(r.rate))) {
        onChangeRef.current(String(r.rate));
      } else {
        setFetchErr('No se obtuvo el tipo de cambio de venta del BCCR.');
      }
    } catch (e) {
      setFetchErr(e?.message || 'No se pudo consultar el BCCR.');
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleUseBccrChange(checked) {
    setUseBccr(checked);
    if (checked) {
      await applyBccr(resolveReferenceDate(referenceDate));
    }
  }

  useEffect(() => {
    if (!useBccr) return;
    applyBccr(resolveReferenceDate(referenceDate));
  }, [referenceDate, useBccr, applyBccr]);

  const defaultInputClass = compact
    ? 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
    : 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2';
  const inputCls = inputClassName || defaultInputClass;

  const checkbox = (
    <label className={`flex items-center gap-2 ${compact ? 'text-xs text-slate-600' : 'text-sm text-slate-700'}`}>
      <input
        type="checkbox"
        checked={useBccr}
        disabled={loading}
        onChange={(e) => handleUseBccrChange(e.target.checked)}
        className="shrink-0"
      />
      <span>Usar tipo de cambio BCCR (venta)</span>
    </label>
  );

  const input = (
    <input
      required={required}
      type="number"
      min="0"
      step="0.000001"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputCls}
    />
  );

  const status = (
    <>
      {loading ? <p className="text-xs text-slate-500">Consultando BCCR…</p> : null}
      {fetchErr ? <p className="text-xs text-rose-600">{fetchErr}</p> : null}
    </>
  );

  if (compact) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {checkbox}
        {input}
        {status}
      </div>
    );
  }

  return (
    <div className="block text-sm">
      <span className="font-medium text-slate-800">
        {label}
        {required ? ' *' : ''}
      </span>
      <div className="mt-2">{checkbox}</div>
      {input}
      <div className="mt-1 space-y-0.5">{status}</div>
    </div>
  );
}
