import { useMemo, useState } from 'react';
import InventorySuppliesTab from './InventorySuppliesTab.jsx';
import InventoryMovementsTab from './InventoryMovementsTab.jsx';
import InventoryStockTab from './InventoryStockTab.jsx';
import BccrUsdReference from '../shared/BccrUsdReference.jsx';

const TABS = [
  { id: 'existencias', label: 'Existencias' },
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'insumos', label: 'Insumos' },
];

export default function InventoryPage({ user }) {
  const [activeTab, setActiveTab] = useState('existencias');
  /** Se incrementa al usar «Registrar inventario» en Existencias; Movimientos abre el formulario al recibir el nuevo valor. */
  const [movementRegisterOpenSignal, setMovementRegisterOpenSignal] = useState(0);

  function goToRegisterInventory() {
    setMovementRegisterOpenSignal((n) => n + 1);
    setActiveTab('movimientos');
  }

  const title = useMemo(() => {
    if (activeTab === 'movimientos') return 'Movimientos de inventario';
    if (activeTab === 'insumos') return 'Catálogo de insumos';
    return 'Stock actual';
  }, [activeTab]);

  return (
    <section className="space-y-4 rounded-2xl border border-white/50 bg-white/90 p-5 text-slate-800 shadow">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-lime-800">Inventario</h3>
          <p className="text-sm text-slate-600">
            Administra existencias, movimientos e insumos. Al ingresar se muestra el stock actual.
          </p>
        </div>
        <BccrUsdReference className="shrink-0 sm:mt-0.5" />
      </header>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              activeTab === tab.id
                ? 'bg-lime-700 text-white'
                : 'bg-white text-slate-700 hover:border-lime-300 hover:bg-lime-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        {activeTab === 'existencias' ? (
          <InventoryStockTab user={user} onRegisterInventory={goToRegisterInventory} />
        ) : null}
        {activeTab === 'movimientos' ? (
          <InventoryMovementsTab user={user} openRegisterSignal={movementRegisterOpenSignal} />
        ) : null}
        {activeTab === 'insumos' ? <InventorySuppliesTab user={user} /> : null}
      </section>
    </section>
  );
}

