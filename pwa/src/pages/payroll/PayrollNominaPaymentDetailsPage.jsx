import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createPayrollNominaContributionRule,
  deactivatePayrollNominaContributionRule,
  listPayrollNominaContributionRules,
} from '../../services/payrollNominaContributionRulesApi.js';

const DEFAULT_FORM = {
  valid_from: '',
  valid_to: '',
  employer_pct_of_gross: '',
  employee_pct_of_gross: '',
  notes: '',
};

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `${Number(n).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 4 })} %`;
}

function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}

function fmtEndDate(d) {
  if (d == null || d === '') return 'Vigente (sin fecha fin)';
  return String(d).slice(0, 10);
}

export default function PayrollNominaPaymentDetailsPage({ user }) {
  const [rows, setRows] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const readOnly = false;

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const data = await listPayrollNominaContributionRules({ active: activeFilter });
      setRows(data || []);
    } catch (e) {
      setListError(e?.message || 'No se pudieron cargar las reglas.');
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openCreate() {
    setForm(DEFAULT_FORM);
    setModalError('');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setModalError('');
    setForm(DEFAULT_FORM);
  }

  function onChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateForm() {
    if (!form.valid_from) return 'Indique la fecha de inicio.';
    if (form.valid_to && form.valid_from > form.valid_to) {
      return 'La fecha de inicio no puede ser posterior a la fecha de finalización.';
    }
    const emp = Number(form.employer_pct_of_gross);
    const epl = Number(form.employee_pct_of_gross);
    if (!Number.isFinite(emp) || emp < 0 || emp > 100) {
      return 'El aporte del patrono debe ser un porcentaje entre 0 y 100.';
    }
    if (!Number.isFinite(epl) || epl < 0 || epl > 100) {
      return 'El aporte del trabajador debe ser un porcentaje entre 0 y 100.';
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (readOnly) return;
    const v = validateForm();
    if (v) {
      setModalError(v);
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      await createPayrollNominaContributionRule({
        valid_from: form.valid_from,
        valid_to: form.valid_to?.trim() ? form.valid_to : null,
        employer_pct_of_gross: Number(form.employer_pct_of_gross),
        employee_pct_of_gross: Number(form.employee_pct_of_gross),
        notes: form.notes.trim() || null,
      });
      closeModal();
      await refresh();
    } catch (e2) {
      setModalError(e2?.message || 'No se pudo crear la regla.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(row) {
    if (readOnly) return;
    if (!window.confirm('¿Inactivar esta regla? No podrá editarse después; el historial se conserva.')) return;
    setSaving(true);
    setListError('');
    try {
      await deactivatePayrollNominaContributionRule(row.id);
      await refresh();
    } catch (e) {
      setListError(e?.message || 'No se pudo inactivar la regla.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-lime-800">Detalles de pagos de nómina</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Reglas por <strong>periodo</strong> (fechas inclusive): porcentaje del patrono y del trabajador sobre el{' '}
            <strong>salario bruto</strong>. Las reglas no se editan para no alterar el historial; puede crear una nueva
            o <strong>inactivar</strong> la anterior. No puede haber periodos activos traslapados: inactive la regla
            vigente si necesita otra que empiece antes. La <strong>fecha de fin</strong> puede dejarse vacía para que la
            regla siga vigente hasta que la inactive.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Todas</option>
            <option value="true">Activas</option>
            <option value="false">Inactivas</option>
          </select>
          {!readOnly ? (
            <button
              type="button"
              onClick={openCreate}
              disabled={saving}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              Nueva regla
            </button>
          ) : null}
        </div>
      </header>

      {listError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{listError}</p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2">Inicio</th>
              <th className="px-3 py-2">Fin</th>
              <th className="px-3 py-2">Patrono (% bruto)</th>
              <th className="px-3 py-2">Trabajador (% bruto)</th>
              <th className="px-3 py-2">Notas</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Cargando…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No hay reglas. Cree la primera para los periodos de planilla.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="px-3 py-2 font-medium text-slate-800">{fmtDate(r.valid_from)}</td>
                  <td className="px-3 py-2 text-slate-700">{fmtEndDate(r.valid_to)}</td>
                  <td className="px-3 py-2">{fmtPct(r.employer_pct_of_gross)}</td>
                  <td className="px-3 py-2">{fmtPct(r.employee_pct_of_gross)}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-600" title={r.notes || ''}>
                    {r.notes || '—'}
                  </td>
                  <td className="px-3 py-2">
                    {r.is_active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                        Activa
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                        Inactiva
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.is_active && !readOnly ? (
                      <button
                        type="button"
                        onClick={() => handleDeactivate(r)}
                        disabled={saving}
                        className="text-xs font-semibold text-amber-800 underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Inactivar
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-800">Nueva regla de nómina</h4>
              <button
                type="button"
                onClick={closeModal}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              >
                Cerrar
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-600">
              Los porcentajes se aplican sobre el <strong>salario bruto</strong>. Esta fila no podrá editarse después;
              solo inactivarse.
            </p>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Vigencia desde *</span>
                <input
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => onChange('valid_from', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Vigencia hasta</span>
                <input
                  type="date"
                  value={form.valid_to}
                  onChange={(e) => onChange('valid_to', e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Opcional. Si la deja vacía, la regla permanece vigente hasta que la inactive.
                </span>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Aporte patrono (% del bruto) *</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  max="100"
                  value={form.employer_pct_of_gross}
                  onChange={(e) => onChange('employer_pct_of_gross', e.target.value)}
                  disabled={saving}
                  placeholder="ej. 26.83"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Aporte trabajador (% del bruto) *</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  max="100"
                  value={form.employee_pct_of_gross}
                  onChange={(e) => onChange('employee_pct_of_gross', e.target.value)}
                  disabled={saving}
                  placeholder="ej. 10.83"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Notas</span>
                <textarea
                  value={form.notes}
                  onChange={(e) => onChange('notes', e.target.value)}
                  disabled={saving}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              {modalError ? <p className="text-sm text-rose-700">{modalError}</p> : null}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
