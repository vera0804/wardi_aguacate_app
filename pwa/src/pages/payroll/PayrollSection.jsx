import { useState } from 'react';
import PayrollNominaPaymentDetailsPage from './PayrollNominaPaymentDetailsPage.jsx';
import PayrollCalculationPage from './PayrollCalculationPage.jsx';
import PayrollAguinaldosPage from './PayrollAguinaldosPage.jsx';

const TABS = [
  { id: 'calculo', label: 'Cálculo de planilla' },
  { id: 'aguinaldos', label: 'Aguinaldos' },
  { id: 'nomina', label: 'Detalles de pagos de nómina' },
];

export default function PayrollSection({ user }) {
  const [tab, setTab] = useState('calculo');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-slate-200 bg-white text-lime-900'
                : 'border-transparent bg-slate-100/80 text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'calculo' ? <PayrollCalculationPage user={user} /> : null}
      {tab === 'aguinaldos' ? <PayrollAguinaldosPage user={user} /> : null}
      {tab === 'nomina' ? <PayrollNominaPaymentDetailsPage user={user} /> : null}
    </div>
  );
}
