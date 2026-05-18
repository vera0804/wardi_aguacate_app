import { useEffect, useMemo, useState } from 'react';
import { getInventoryStockLayers, getInventoryStockTotal, listInventoryStock } from '../services/inventoryMovements.js';

function fmtQty(v) {
  return Number(v || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' });
}

export default function InventoryStockTab({ user, onRegisterInventory }) {
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [layerOpen, setLayerOpen] = useState(null);
  const [layers, setLayers] = useState([]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      if (isAdmin) {
        const [stock, totalRes] = await Promise.all([listInventoryStock(), getInventoryStockTotal()]);
        setRows(Array.isArray(stock) ? stock : []);
        setTotal(Number(totalRes?.total_value_crc || 0));
      } else {
        const stock = await listInventoryStock();
        setRows(Array.isArray(stock) ? stock : []);
        setTotal(0);
      }
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el stock.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [user?.clientId, isAdmin]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeOnly && !r.item_is_active) return false;
      if (!q) return true;
      return [r.item_name, r.category_name, r.brand_name].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [rows, search, activeOnly]);

  async function openLayers(itemId) {
    try {
      const data = await getInventoryStockLayers(itemId);
      setLayers(data?.layers || []);
      setLayerOpen(itemId);
    } catch (e) {
      setError(e?.message || 'No se pudieron cargar capas.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-md">
          {isAdmin ? (
            <SummaryCard title="Stock valorizado (CRC)" value={fmtMoney(total)} />
          ) : (
            <SummaryCard title="Stock valorizado (CRC)" value="—" />
          )}
        </div>
        {typeof onRegisterInventory === 'function' ? (
          <div className="flex justify-end sm:shrink-0">
            <button
              type="button"
              onClick={() => onRegisterInventory()}
              className="rounded-lg bg-lime-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-lime-800"
            >
              Registrar inventario
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm">
          <input id="stock-active" type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          <label htmlFor="stock-active">Solo insumos activos</label>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por insumo/categoría/marca"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-80"
          />
          <button type="button" onClick={load} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            Recargar
          </button>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              {['Insumo', 'Categoría', 'Marca', 'Unidad', 'Stock', 'Valor CRC', 'Estado', 'Acciones'].map((col) => (
                <th key={col} className="px-3 py-2 font-semibold">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Cargando...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sin datos.</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.item_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.item_name}</td>
                  <td className="px-3 py-2">{r.category_name || '—'}</td>
                  <td className="px-3 py-2">{r.brand_name || '—'}</td>
                  <td className="px-3 py-2">{r.unit}</td>
                  <td className="px-3 py-2">{fmtQty(r.stock_qty)}</td>
                  <td className="px-3 py-2">{isAdmin ? fmtMoney(r.stock_value_crc) : '—'}</td>
                  <td className="px-3 py-2">{r.item_is_active ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => openLayers(r.item_id)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      Ver capas
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {layerOpen ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <h5 className="text-sm font-semibold text-slate-800">Capas FIFO del insumo</h5>
            <button type="button" onClick={() => setLayerOpen(null)} className="text-xs text-slate-600 hover:text-slate-900">
              Cerrar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="px-2 py-1">Fecha capa</th>
                  <th className="px-2 py-1">Cantidad ingreso</th>
                  <th className="px-2 py-1">Cantidad restante</th>
                  <th className="px-2 py-1">Costo unitario CRC</th>
                  <th className="px-2 py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-2 py-1">{String(l.layer_date || '').slice(0, 10)}</td>
                    <td className="px-2 py-1">{fmtQty(l.qty_in)}</td>
                    <td className="px-2 py-1">{fmtQty(l.qty_remaining)}</td>
                    <td className="px-2 py-1">{isAdmin ? fmtMoney(l.unit_cost) : '—'}</td>
                    <td className="px-2 py-1">{l.is_active ? 'Activa' : 'Inactiva'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-800">{value}</p>
    </article>
  );
}

