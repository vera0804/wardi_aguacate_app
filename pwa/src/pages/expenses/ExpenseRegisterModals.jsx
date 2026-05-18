import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getExpensesMeta, createExpense, createGeneralExpense } from '../../services/expensesApi.js';
import { listFarms } from '../../services/farms.js';
import { enqueuePendingJob } from '../../offline/expensesSyncStore.js';
import ExpenseCategoryCombo from './ExpenseCategoryCombo.jsx';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const emptyLotForm = {
  lot_id: '',
  exp_date: today(),
  category_id: '',
  description: '',
  currency: 'CRC',
  amount_input: '',
  fx_rate: '',
};

const emptyGeneralForm = {
  farm_id: '',
  exp_date: today(),
  category_id: '',
  description: '',
  currency: 'CRC',
  amount_input: '',
  fx_rate: '',
};

/** Reparto de gastos generales: mismo criterio que labores/inventario (`labor_allocation_mode` de la finca). */
function generalExpenseAllocationMethodForCreate(farmId, farmsList) {
  if (!farmId) return 'area_ha';
  const farm = (farmsList || []).find((f) => String(f.id) === String(farmId));
  const mode = String(farm?.labor_allocation_mode || 'area').toLowerCase();
  return mode === 'manual' ? 'manual' : 'area_ha';
}

function isNetworkish(err) {
  return (
    !navigator.onLine ||
    String(err?.message || '')
      .toLowerCase()
      .includes('failed to fetch')
  );
}

export function ExpenseRegisterLotModal({ open, onClose, onSaved }) {
  const [meta, setMeta] = useState({ lots: [] });
  const [farmId, setFarmId] = useState('');
  const [form, setForm] = useState(emptyLotForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(emptyLotForm);
    setFarmId('');
    getExpensesMeta()
      .then((data) => setMeta({ lots: data?.lots || [] }))
      .catch(() => setMeta({ lots: [] }));
  }, [open]);

  const farms = useMemo(() => {
    const m = new Map();
    (meta.lots || []).forEach((l) => {
      if (l.farm_id && !m.has(l.farm_id)) m.set(l.farm_id, { id: l.farm_id, name: l.farm_name || '—' });
    });
    return [...m.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));
  }, [meta.lots]);

  const lotsForFarm = useMemo(
    () => (meta.lots || []).filter((l) => !farmId || l.farm_id === farmId),
    [meta.lots, farmId]
  );

  useEffect(() => {
    if (!farmId) {
      setForm((f) => ({ ...f, lot_id: '' }));
      return;
    }
    setForm((f) => {
      const still = (meta.lots || []).some((l) => l.farm_id === farmId && l.id === f.lot_id);
      return still ? f : { ...f, lot_id: '' };
    });
  }, [farmId, meta.lots]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    if (!form.category_id) {
      setError('Elija una categoría de la lista o cree una nueva.');
      setSaving(false);
      return;
    }
    const amount_input = Number(form.amount_input);
    const body = {
      lot_id: form.lot_id,
      exp_date: form.exp_date,
      category_id: form.category_id,
      description: form.description.trim() || null,
      currency: form.currency,
      amount_input,
    };
    if (form.currency === 'USD') body.fx_rate = Number(form.fx_rate);
    try {
      await createExpense(body);
      onSaved?.();
      onClose();
    } catch (err) {
      if (isNetworkish(err)) {
        try {
          await enqueuePendingJob('lot_expenses', { kind: 'create', body });
          setError('Sin conexión: el gasto quedó en cola. Use «Reintentar ahora» en el historial cuando haya red.');
        } catch {
          setError(err?.message || 'No se pudo guardar.');
        }
      } else {
        setError(err?.message || 'No se pudo guardar.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-lime-800">Registrar gasto por lote</h3>
        <p className="mt-1 text-xs text-slate-600">
          Elija finca y lote; el monto completo se imputa a ese lote.
        </p>
        {error ? <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-800">{error}</p> : null}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <fieldset className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3 sm:grid-cols-2">
            <legend className="sr-only">Ubicación del gasto</legend>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-800">Finca *</span>
              <select
                required
                value={farmId}
                onChange={(e) => setFarmId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Seleccione…</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="font-medium text-slate-800">Lote *</span>
              <select
                required
                value={form.lot_id}
                disabled={!farmId}
                onChange={(e) => setForm((f) => ({ ...f, lot_id: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
              >
                <option value="">{farmId ? 'Seleccione lote…' : 'Primero elija la finca'}</option>
                {lotsForFarm.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <label className="block text-sm">
            <span className="font-medium text-slate-800">Fecha *</span>
            <input
              required
              type="date"
              value={form.exp_date}
              onChange={(e) => setForm((f) => ({ ...f, exp_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <ExpenseCategoryCombo
            key={open ? 'lot-cat' : 'lot-cat-closed'}
            valueId={form.category_id}
            onValueChange={(id) => setForm((f) => ({ ...f, category_id: id }))}
          />
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Descripción</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Moneda</span>
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="CRC">CRC</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Monto</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.amount_input}
              onChange={(e) => setForm((f) => ({ ...f, amount_input: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          {form.currency === 'USD' ? (
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Tipo de cambio (CRC por USD) *</span>
              <input
                required
                type="number"
                min="0"
                step="0.000001"
                value={form.fx_rate}
                onChange={(e) => setForm((f) => ({ ...f, fx_rate: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ExpenseRegisterGeneralModal({ open, onClose, onSaved }) {
  const navigate = useNavigate();
  const [farms, setFarms] = useState([]);
  const [form, setForm] = useState(emptyGeneralForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(emptyGeneralForm);
    listFarms()
      .then((fRes) => setFarms(Array.isArray(fRes) ? fRes : []))
      .catch(() => setFarms([]));
  }, [open]);

  if (!open) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    if (!form.category_id) {
      setError('Elija una categoría de la lista o cree una nueva.');
      setSaving(false);
      return;
    }
    const body = {
      farm_id: form.farm_id || null,
      exp_date: form.exp_date,
      category_id: form.category_id,
      description: form.description.trim() || null,
      allocation_method: generalExpenseAllocationMethodForCreate(form.farm_id, farms),
      currency: form.currency,
      amount_input: Number(form.amount_input),
    };
    if (form.currency === 'USD') body.fx_rate = Number(form.fx_rate);
    try {
      const created = await createGeneralExpense(body);
      const id = created?.id;
      if (id) navigate(`/expenses/general/${id}`);
      else {
        onSaved?.();
        navigate('/expenses/historial');
      }
    } catch (err) {
      if (isNetworkish(err)) {
        try {
          await enqueuePendingJob('general_expenses', { kind: 'create', body });
          setError('Sin conexión: el alta quedó en cola. Reintente desde el historial cuando haya red.');
        } catch {
          setError(err?.message || 'No se pudo crear.');
        }
      } else {
        setError(err?.message || 'No se pudo crear.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-lime-800">Registrar gasto general</h3>
        <p className="mt-1 text-xs text-slate-600">
          Elija el alcance (una finca o toda la empresa). El reparto entre lotes usa el método configurado en la finca
          (área o manual); si el alcance es toda la empresa, se prorratea por área de lote.
        </p>
        {error ? <p className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-sm text-rose-800">{error}</p> : null}
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <fieldset className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
            <legend className="sr-only">Alcance y reparto</legend>
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Finca del alcance (opcional)</span>
              <select
                value={form.farm_id}
                onChange={(e) => setForm((f) => ({ ...f, farm_id: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Todas las fincas (lotes con área de la empresa)</option>
                {farms.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {form.farm_id ? (
              <p className="text-xs text-slate-600">
                Reparto entre lotes:{' '}
                <strong>
                  {generalExpenseAllocationMethodForCreate(form.farm_id, farms) === 'manual'
                    ? 'manual (como en la finca)'
                    : 'por hectáreas (como en la finca)'}
                </strong>
                .
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                Alcance global: reparto <strong>por hectáreas</strong> entre lotes con área de la empresa.
              </p>
            )}
          </fieldset>

          <label className="block text-sm">
            <span className="font-medium text-slate-800">Fecha *</span>
            <input
              required
              type="date"
              value={form.exp_date}
              onChange={(e) => setForm((f) => ({ ...f, exp_date: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <ExpenseCategoryCombo
            key={open ? 'gen-cat' : 'gen-cat-closed'}
            valueId={form.category_id}
            onValueChange={(id) => setForm((f) => ({ ...f, category_id: id }))}
          />
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Descripción</span>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Moneda</span>
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="CRC">CRC</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-800">Monto total</span>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={form.amount_input}
              onChange={(e) => setForm((f) => ({ ...f, amount_input: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          {form.currency === 'USD' ? (
            <label className="block text-sm">
              <span className="font-medium text-slate-800">Tipo de cambio (CRC por USD) *</span>
              <input
                required
                type="number"
                min="0"
                step="0.000001"
                value={form.fx_rate}
                onChange={(e) => setForm((f) => ({ ...f, fx_rate: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white hover:bg-lime-800 disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Crear gasto general'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
