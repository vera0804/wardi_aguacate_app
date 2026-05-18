import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ExpenseRegisterGeneralModal, ExpenseRegisterLotModal } from './ExpenseRegisterModals.jsx';

export default function ExpensesWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const [listBump, setListBump] = useState(0);

  const path = location.pathname;
  const tab = useMemo(() => {
    if (path.includes('/registro/lote')) return 'reg-lote';
    if (path.includes('/registro/general')) return 'reg-gen';
    return 'historial';
  }, [path]);

  const lotModalOpen = path.includes('/registro/lote');
  const genModalOpen = path.includes('/registro/general');

  function goHistorial() {
    navigate('/expenses/historial');
  }

  const tabs = [
    { id: 'historial', label: 'Historial', to: '/expenses/historial' },
    { id: 'reg-lote', label: 'Registrar gasto por lote', to: '/expenses/registro/lote' },
    { id: 'reg-gen', label: 'Registrar gasto general', to: '/expenses/registro/general' },
  ];

  return (
    <>
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(t.to)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              tab === t.id ? 'bg-lime-700 text-white' : 'bg-white text-slate-700 hover:bg-lime-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <Outlet context={{ listBump, bumpLists: () => setListBump((n) => n + 1) }} />
      </div>

      <ExpenseRegisterLotModal
        open={lotModalOpen}
        onClose={goHistorial}
        onSaved={() => setListBump((n) => n + 1)}
      />
      <ExpenseRegisterGeneralModal
        open={genModalOpen}
        onClose={goHistorial}
        onSaved={() => setListBump((n) => n + 1)}
      />
    </>
  );
}
