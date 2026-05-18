import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createInventoryAdjustment,
  createInventoryMovement,
  getInventoryMovementById,
  getInventoryMovementsMeta,
  getInventoryStockLayers,
  listInventoryMovements,
  setInventoryMovementActive,
  updateInventoryMovement,
} from '../services/inventoryMovements.js';
import { createInventoryItem, getInventoryItemsMeta } from '../services/inventoryItems.js';
import InventoryBrandCombo from './InventoryBrandCombo.jsx';

const OUT_NOTES_MIN_LEN = 5;

const EMPTY_MOVEMENT = {
  movement: 'in',
  item_id: '',
  mov_date: new Date().toISOString().slice(0, 10),
  pack_mode: false,
  pack_label: '',
  pack_count: '',
  pack_size: '',
  pack_unit: '',
  pack_cost: '',
  qty: '',
  unit_cost: '',
  total_cost: '',
  currency: 'CRC',
  fx_rate: '',
  unit_cost_usd: '',
  total_cost_usd: '',
  notes: '',
  counted_qty: '',
  source_layer_id: '',
  has_refund: 'no',
  refund_crc: '',
};

const EMPTY_NEW_ITEM = {
  name: '',
  unit: 'kg',
  category_id: '',
  brand_id: '',
  brand_name: '',
};

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('es-CR', { style: 'currency', currency: 'CRC' });
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const FL_OZ_PER_LITER = 33.81;
const OZ_MASS_PER_KG = 35.274;

function normalizeUnit(value) {
  const v = String(value || '').trim().toLowerCase();
  const map = {
    cc: 'cc',
    ml: 'cc',
    litro: 'litro',
    litros: 'litro',
    l: 'litro',
    kg: 'kg',
    kilo: 'kg',
    gramos: 'gramo',
    gramo: 'gramo',
    g: 'gramo',
    onza_liquida: 'onza_liquida',
    onza_masa: 'onza_masa',
    fl_oz: 'onza_liquida',
    oz_liquida: 'onza_liquida',
    oz_masa: 'onza_masa',
    onza: 'onza',
    onzas: 'onza',
    oz: 'onza',
    unidad: 'unidad',
    unidades: 'unidad',
    und: 'unidad',
  };
  return map[v] || v;
}

function resolveAmbiguousOnza(otherUnit) {
  const vol = new Set(['litro', 'cc', 'onza_liquida']);
  const mass = new Set(['kg', 'gramo', 'onza_masa']);
  if (vol.has(otherUnit)) return 'onza_liquida';
  if (mass.has(otherUnit)) return 'onza_masa';
  return 'onza_masa';
}

function convertQty(qty, fromUnit, toUnit) {
  let from = normalizeUnit(fromUnit);
  let to = normalizeUnit(toUnit);
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (from === 'onza') from = resolveAmbiguousOnza(to);
  if (to === 'onza') to = resolveAmbiguousOnza(from);
  if (from === to) return n;
  if (from === 'cc' && to === 'litro') return n / 1000;
  if (from === 'litro' && to === 'cc') return n * 1000;
  if (from === 'gramo' && to === 'kg') return n / 1000;
  if (from === 'kg' && to === 'gramo') return n * 1000;
  if (from === 'onza_liquida' && to === 'litro') return n / FL_OZ_PER_LITER;
  if (from === 'litro' && to === 'onza_liquida') return n * FL_OZ_PER_LITER;
  if (from === 'onza_liquida' && to === 'cc') return (n / FL_OZ_PER_LITER) * 1000;
  if (from === 'cc' && to === 'onza_liquida') return (n / 1000) * FL_OZ_PER_LITER;
  if (from === 'onza_masa' && to === 'kg') return n / OZ_MASS_PER_KG;
  if (from === 'kg' && to === 'onza_masa') return n * OZ_MASS_PER_KG;
  if (from === 'onza_masa' && to === 'gramo') return (n / OZ_MASS_PER_KG) * 1000;
  if (from === 'gramo' && to === 'onza_masa') return (n / 1000) * OZ_MASS_PER_KG;
  return null;
}

function formatPackUnitLabel(u) {
  const x = String(u || '').trim().toLowerCase();
  if (x === 'onza_liquida') return 'Onza líquida (fl oz)';
  if (x === 'onza_masa') return 'Onza de masa (oz)';
  return u || '—';
}

/** Sufijo corto para cantidades en tabla (unidad base del insumo). */
function formatItemUnitShort(unit) {
  const raw = String(unit || '').trim().toLowerCase();
  if (!raw) return '';
  const u = normalizeUnit(raw);
  if (u === 'litro') return 'l';
  if (u === 'kg') return 'kg';
  if (u === 'unidad') return 'unidad';
  if (u === 'gramo') return 'g';
  if (u === 'cc') return 'cc';
  return raw;
}

function formatQtyWithUnit(qty, itemUnit) {
  const n = Number(qty || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const suf = formatItemUnitShort(itemUnit);
  return suf ? `${n} ${suf}` : n;
}

function itemOptionLabel(it) {
  if (!it) return '';
  return `${it.name} (${it.unit})`;
}

export default function InventoryMovementsTab({ user, openRegisterSignal = 0 }) {
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';
  const isOperario = String(user?.role || '').trim().toLowerCase() === 'operario';
  const canUseMovementForm = isAdmin || isOperario;

  function inboundMovementConsumed(row) {
    if (!row || String(row.movement) !== 'in') return false;
    const qi = row.inbound_layer_qty_in;
    const qr = row.inbound_layer_qty_remaining;
    if (qi == null || qr == null) return false;
    return Number(qr) < Number(qi);
  }

  function canMutateMovementRow(row) {
    if (!row) return false;
    if (inboundMovementConsumed(row)) return false;
    if (isAdmin) return true;
    return isOperario && String(row.movement) === 'in';
  }

  const readOnly = !canUseMovementForm;
  const [meta, setMeta] = useState({ items: [] });
  const [rows, setRows] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showNewItemForm, setShowNewItemForm] = useState(false);
  const [form, setForm] = useState(EMPTY_MOVEMENT);
  const [newItemForm, setNewItemForm] = useState(EMPTY_NEW_ITEM);
  const [itemMeta, setItemMeta] = useState({ categories: [] });
  const [filters, setFilters] = useState({ movement: '', active: 'true', from_date: '', to_date: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewRow, setViewRow] = useState(null);
  const [viewDetailLoading, setViewDetailLoading] = useState(false);
  const [outLayers, setOutLayers] = useState([]);
  const [outLayersLoading, setOutLayersLoading] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [editDraft, setEditDraft] = useState({ mov_date: '', notes: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveError, setEditSaveError] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const itemPickerRef = useRef(null);
  const inlineCreateRef = useRef(null);
  const movementFormRef = useRef(null);

  async function loadMeta() {
    const [movMeta, invMeta] = await Promise.all([getInventoryMovementsMeta(), getInventoryItemsMeta()]);
    setMeta(movMeta || { items: [] });
    setItemMeta(invMeta || { categories: [] });
  }

  async function loadRows() {
    setLoading(true);
    setError('');
    try {
      const rowsData = await listInventoryMovements(filters);
      setRows(Array.isArray(rowsData) ? rowsData : []);
    } catch (e) {
      setError(e?.message || 'No se pudo cargar movimientos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMeta().catch((e) => setError(e?.message || 'No se pudo cargar catálogo.'));
  }, [user?.clientId]);

  useEffect(() => {
    if (openRegisterSignal <= 0) return undefined;
    setShowForm(true);
    setShowNewItemForm(false);
    setItemPickerOpen(false);
    const t = window.setTimeout(() => {
      movementFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [openRegisterSignal]);

  useEffect(() => {
    loadRows();
  }, [filters.active, filters.from_date, filters.movement, filters.to_date, user?.clientId]);

  useEffect(() => {
    if (!form.item_id) return;
    const it = meta.items?.find((x) => x.id === form.item_id);
    if (it) setItemSearch(itemOptionLabel(it));
  }, [form.item_id, meta.items]);

  useEffect(() => {
    if (form.movement !== 'out' || !form.item_id) {
      setOutLayers([]);
      return undefined;
    }
    let cancelled = false;
    setOutLayersLoading(true);
    getInventoryStockLayers(form.item_id, { onlyAvailable: true })
      .then((data) => {
        if (!cancelled) setOutLayers(Array.isArray(data?.layers) ? data.layers : []);
      })
      .catch(() => {
        if (!cancelled) setOutLayers([]);
      })
      .finally(() => {
        if (!cancelled) setOutLayersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.movement, form.item_id]);

  useEffect(() => {
    if (!itemPickerOpen) return;
    function onDocMouseDown(e) {
      if (itemPickerRef.current && !itemPickerRef.current.contains(e.target)) {
        setItemPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [itemPickerOpen]);

  useEffect(() => {
    if (!showNewItemForm || !showForm) return;
    requestAnimationFrame(() => {
      inlineCreateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [showNewItemForm, showForm]);

  const filteredItems = useMemo(() => {
    const list = meta.items || [];
    const q = itemSearch.trim().toLowerCase();
    if (!q) return list.slice(0, 150);
    return list.filter((it) => `${it.name} ${it.unit}`.toLowerCase().includes(q));
  }, [meta.items, itemSearch]);

  const selectedItem = useMemo(
    () => meta.items?.find((x) => x.id === form.item_id) || null,
    [meta.items, form.item_id]
  );
  const packDerivedQty = useMemo(() => {
    if (!form.pack_mode) return null;
    const count = Number(form.pack_count);
    const size = Number(form.pack_size);
    if (!Number.isFinite(count) || !Number.isFinite(size) || count <= 0 || size <= 0) return null;
    const inPackUnit = count * size;
    if (!selectedItem?.unit) return null;
    const converted = convertQty(inPackUnit, form.pack_unit, selectedItem.unit);
    return Number.isFinite(converted) && converted > 0 ? converted : null;
  }, [form.pack_count, form.pack_mode, form.pack_size, form.pack_unit, selectedItem?.unit]);

  const selectedOutLayer = useMemo(
    () => outLayers.find((l) => l.id === form.source_layer_id) || null,
    [outLayers, form.source_layer_id]
  );

  const outCostPreview = useMemo(() => {
    if (form.movement !== 'out' || !selectedOutLayer) return null;
    const q = Number(form.qty);
    if (!Number.isFinite(q) || q <= 0) return null;
    const gross = round2(q * Number(selectedOutLayer.unit_cost));
    if (form.has_refund !== 'yes') {
      return { gross, net: gross };
    }
    const raw = form.refund_crc;
    if (raw === '' || raw == null) {
      return { gross, net: null };
    }
    const ref = Number(raw);
    if (!Number.isFinite(ref) || ref < 0) return null;
    return { gross, net: round2(gross - ref) };
  }, [form.movement, form.qty, form.has_refund, form.refund_crc, selectedOutLayer]);

  function onFormChange(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function onItemSearchInput(value) {
    setItemSearch(value);
    setItemPickerOpen(true);
    const sel = meta.items?.find((x) => x.id === form.item_id);
    if (sel && itemOptionLabel(sel) === value.trim()) return;
    if (form.item_id) setForm((prev) => ({ ...prev, item_id: '', source_layer_id: '', has_refund: 'no', refund_crc: '' }));
  }

  function selectInventoryItem(it) {
    setForm((prev) => ({
      ...prev,
      item_id: it.id,
      source_layer_id: '',
      has_refund: 'no',
      refund_crc: '',
    }));
    setItemSearch(itemOptionLabel(it));
    setItemPickerOpen(false);
  }

  function openCreateItemFromSearch() {
    const name = itemSearch.trim();
    if (!name) return;
    setError('');
    setNewItemForm((p) => ({ ...p, name }));
    setShowNewItemForm(true);
    setItemPickerOpen(false);
  }

  async function onCreateMovement(e) {
    e.preventDefault();
    if (!canUseMovementForm) return;
    if (isOperario && form.movement !== 'in') {
      setError('Solo el administrador puede registrar salidas o ajustes.');
      return;
    }
    if (!form.item_id) {
      setError('Selecciona un insumo de la lista o créalo si no existe.');
      return;
    }
    if (form.movement === 'out') {
      const obs = String(form.notes || '').trim();
      if (obs.length < OUT_NOTES_MIN_LEN) {
        setError(
          `En salidas las observaciones son obligatorias (motivo: vencido, mal estado, donación, etc.). Mínimo ${OUT_NOTES_MIN_LEN} caracteres.`
        );
        return;
      }
      if (!form.source_layer_id) {
        setError('Debe elegir la capa (lote) de la que sale la mercadería.');
        return;
      }
      const qOut = Number(form.qty);
      const layer = outLayers.find((l) => l.id === form.source_layer_id);
      const maxRem = layer != null ? Number(layer.qty_remaining) : NaN;
      if (!Number.isFinite(qOut) || qOut <= 0) {
        setError('Indique una cantidad válida a dar de baja.');
        return;
      }
      if (layer && qOut > maxRem + 0.0001) {
        setError('La cantidad no puede superar el saldo disponible en la capa elegida.');
        return;
      }
      const uc = Number(layer?.unit_cost);
      const grossEst = round2(qOut * uc);
      let refCr = 0;
      if (form.has_refund === 'yes') {
        refCr = Number(form.refund_crc);
        if (!Number.isFinite(refCr) || refCr <= 0) {
          setError('Si marcó que sí hubo reintegro, escriba cuántos colones le devolvieron (debe ser mayor a 0).');
          return;
        }
      }
      if (refCr > grossEst + 0.01) {
        setError('El monto del reintegro no puede superar el costo bruto de esta salida en la capa elegida.');
        return;
      }
    }
    setSubmitting(true);
    setError('');
    try {
      const payload = { ...form };
      if (payload.movement === 'out') {
        delete payload.pack_mode;
        delete payload.pack_label;
        delete payload.pack_count;
        delete payload.pack_size;
        delete payload.pack_unit;
        delete payload.pack_cost;
        delete payload.unit_cost;
        delete payload.total_cost;
        delete payload.unit_cost_usd;
        delete payload.total_cost_usd;
        delete payload.fx_rate;
        delete payload.counted_qty;
        delete payload.has_refund;
        if (form.has_refund !== 'yes') {
          payload.refund_crc = '0';
        }
      } else if (!payload.pack_mode) {
        delete payload.pack_label;
        delete payload.pack_count;
        delete payload.pack_size;
        delete payload.pack_unit;
        delete payload.pack_cost;
      } else {
        delete payload.unit_cost;
        delete payload.total_cost;
        delete payload.unit_cost_usd;
        delete payload.total_cost_usd;
      }
      if (payload.pack_mode && packDerivedQty != null) {
        if (payload.movement === 'adjust') payload.counted_qty = String(packDerivedQty);
        else payload.qty = String(packDerivedQty);
      }
      if (payload.movement === 'adjust') {
        delete payload.source_layer_id;
        delete payload.refund_crc;
        delete payload.has_refund;
        delete payload.unit_cost;
        delete payload.total_cost;
        delete payload.unit_cost_usd;
        delete payload.total_cost_usd;
        delete payload.fx_rate;
        delete payload.currency;
        delete payload.pack_cost;
        await createInventoryAdjustment(payload);
      } else {
        if (payload.movement !== 'out') {
          delete payload.source_layer_id;
          delete payload.refund_crc;
          delete payload.has_refund;
        }
        await createInventoryMovement(payload);
      }
      setForm(EMPTY_MOVEMENT);
      setItemSearch('');
      setItemPickerOpen(false);
      setShowNewItemForm(false);
      setShowForm(false);
      await loadRows();
    } catch (err) {
      setError(err?.message || 'No se pudo registrar movimiento.');
    } finally {
      setSubmitting(false);
    }
  }

  async function openViewMovement(row) {
    setViewRow(row);
    setViewDetailLoading(true);
    setError('');
    try {
      const full = await getInventoryMovementById(row.id);
      setViewRow(full);
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el detalle del movimiento.');
      setViewRow(null);
    } finally {
      setViewDetailLoading(false);
    }
  }

  async function onToggleActive(row) {
    if (!canMutateMovementRow(row)) return;
    const to = !row.is_active;
    const ok = window.confirm(`${to ? 'Activar' : 'Inactivar'} este movimiento?`);
    if (!ok) return;
    try {
      await setInventoryMovementActive(row.id, to);
      await loadRows();
    } catch (e) {
      setError(e?.message || 'No se pudo actualizar estado.');
    }
  }

  function openEditModal(row) {
    if (!canMutateMovementRow(row)) return;
    setViewRow(null);
    setEditRow(row);
    setEditDraft({
      mov_date: String(row.mov_date || '').slice(0, 10),
      notes: row.notes != null ? String(row.notes) : '',
    });
    setEditSaveError('');
    setError('');
  }

  function closeEditModal() {
    setEditRow(null);
    setEditDraft({ mov_date: '', notes: '' });
    setEditSaveError('');
  }

  async function saveEditModal() {
    if (!editRow || !canMutateMovementRow(editRow)) return;
    setEditSaving(true);
    setEditSaveError('');
    try {
      await updateInventoryMovement(editRow.id, {
        mov_date: editDraft.mov_date,
        notes: editDraft.notes,
      });
      closeEditModal();
      await loadRows();
    } catch (e) {
      setEditSaveError(e?.message || 'No se pudo actualizar movimiento.');
    } finally {
      setEditSaving(false);
    }
  }

  async function submitNewItem() {
    if (!canUseMovementForm) return;
    if (!String(newItemForm.name || '').trim()) {
      setError('El nombre del insumo es obligatorio.');
      return;
    }
    if (!newItemForm.category_id) {
      setError('Selecciona una categoría para el insumo.');
      return;
    }
    setError('');
    try {
      const created = await createInventoryItem({
        name: newItemForm.name.trim(),
        unit: newItemForm.unit,
        category_id: newItemForm.category_id,
        brand_id: newItemForm.brand_id || null,
        brand_name: newItemForm.brand_id ? null : newItemForm.brand_name?.trim() || null,
      });
      setShowNewItemForm(false);
      setNewItemForm(EMPTY_NEW_ITEM);
      await loadMeta();
      setForm((prev) => ({ ...prev, item_id: created.id, source_layer_id: '', has_refund: 'no', refund_crc: '' }));
    } catch (e2) {
      setError(e2?.message || 'No se pudo crear insumo.');
    }
  }

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <select value={filters.movement} onChange={(e) => setFilters((p) => ({ ...p, movement: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Tipo: todos</option>
            <option value="in">Entrada</option>
            <option value="out">Salida</option>
            <option value="adjust">Ajuste</option>
          </select>
          <input type="date" value={filters.from_date} onChange={(e) => setFilters((p) => ({ ...p, from_date: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          <input type="date" value={filters.to_date} onChange={(e) => setFilters((p) => ({ ...p, to_date: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          <select value={filters.active} onChange={(e) => setFilters((p) => ({ ...p, active: e.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="true">Estado: activo</option>
            <option value="false">Estado: inactivo</option>
            <option value="">Estado: todos</option>
          </select>
        </div>
      </section>

      <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
        <h4 className="text-sm font-semibold text-slate-800">Movimientos de inventario</h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => {
              setShowForm((v) => {
                const next = !v;
                if (next && !isAdmin) {
                  setForm({ ...EMPTY_MOVEMENT });
                }
                if (v) {
                  setShowNewItemForm(false);
                  setItemPickerOpen(false);
                }
                return next;
              });
            }}
            className="rounded-lg bg-lime-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {showForm ? 'Ocultar formulario' : 'Registrar movimiento'}
          </button>
          <button type="button" onClick={loadRows} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            Recargar
          </button>
        </div>
      </section>

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

      {showForm ? (
        <form
          ref={movementFormRef}
          onSubmit={onCreateMovement}
          className="space-y-2 rounded-xl border border-lime-200 bg-white p-3"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <select
              value={form.movement}
              disabled={!isAdmin}
              onChange={(e) => {
                const v = e.target.value;
                setForm((prev) => {
                  const leavingOut = v !== 'out';
                  const enteringOut = v === 'out' && prev.movement !== 'out';
                  return {
                    ...prev,
                    movement: v,
                    pack_mode: v === 'out' ? false : prev.pack_mode,
                    source_layer_id: leavingOut ? '' : prev.source_layer_id,
                    refund_crc: leavingOut || enteringOut ? '' : prev.refund_crc,
                    has_refund: leavingOut || enteringOut ? 'no' : prev.has_refund,
                  };
                });
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="in">Entrada</option>
              {isAdmin ? (
                <>
                  <option value="out">Salida</option>
                  <option value="adjust">Ajuste físico</option>
                </>
              ) : null}
            </select>
            <div ref={itemPickerRef} className="relative">
              <input
                type="text"
                autoComplete="off"
                disabled={readOnly}
                value={itemSearch}
                onChange={(e) => onItemSearchInput(e.target.value)}
                onFocus={() => setItemPickerOpen(true)}
                placeholder="Buscar insumo por nombre o unidad…"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-60"
              />
              {itemPickerOpen ? (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg">
                  {filteredItems.length > 0 ? (
                    filteredItems.map((it) => (
                      <button
                        key={it.id}
                        type="button"
                        className="flex w-full px-3 py-2 text-left hover:bg-lime-50"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectInventoryItem(it)}
                      >
                        {itemOptionLabel(it)}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-slate-600">
                      <p className="text-xs">No hay insumos que coincidan.</p>
                      {!readOnly && itemSearch.trim() ? (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg border border-lime-600 bg-lime-50 px-2 py-1.5 text-xs font-semibold text-lime-900"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openCreateItemFromSearch();
                          }}
                        >
                          Crear insumo «{itemSearch.trim()}»
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            <input type="date" value={form.mov_date} onChange={(e) => onFormChange('mov_date', e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" required />
          </div>
          {form.movement === 'out' ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm">
              <p className="font-medium text-amber-950">Salida por capa (lote)</p>
              <p className="text-xs text-amber-900/90">
                Elija de qué ingreso sale la mercadería (solo capas con saldo). Puede dar de baja todo el saldo de esa
                capa o solo una parte. El costo sigue la valorización de la capa. Luego responda si el proveedor (o
                quien corresponda) le devolvió dinero: si la respuesta es no, el costo de inventario que se da de baja
                coincide con el costo bruto de la capa; si es sí, escriba cuántos colones le devolvieron para que el
                costo neto del movimiento refleje ese reintegro.
              </p>
              {!form.item_id ? (
                <p className="text-xs text-slate-600">Primero seleccione el insumo.</p>
              ) : outLayersLoading ? (
                <p className="text-xs text-slate-600">Cargando capas disponibles…</p>
              ) : outLayers.length === 0 ? (
                <p className="text-xs text-rose-700">No hay capas con saldo para este insumo.</p>
              ) : (
                <ul className="max-h-56 space-y-2 overflow-y-auto">
                  {outLayers.map((ly) => {
                    const inboundParts = [
                      ly.inbound_pack_label ? String(ly.inbound_pack_label) : null,
                      ly.inbound_pack_count != null && ly.inbound_pack_size != null
                        ? `${ly.inbound_pack_count}×${ly.inbound_pack_size} ${formatPackUnitLabel(ly.inbound_pack_unit)}`
                        : null,
                    ].filter(Boolean);
                    return (
                      <li key={ly.id}>
                        <label className="flex cursor-pointer gap-2 rounded-lg border border-amber-200/80 bg-white px-2 py-2 hover:border-amber-400">
                          <input
                            type="radio"
                            name="out_layer_pick"
                            checked={form.source_layer_id === ly.id}
                            onChange={() => onFormChange('source_layer_id', ly.id)}
                            className="mt-1"
                          />
                          <span className="min-w-0 flex-1 text-xs leading-snug">
                            <span className="font-semibold text-slate-900">
                              Fecha capa {String(ly.layer_date || '').slice(0, 10)}
                            </span>
                            {' · '}
                            <span className="text-slate-700">Saldo {formatQtyWithUnit(ly.qty_remaining, selectedItem?.unit)}</span>
                            {' · '}
                            <span className="text-slate-700">Costo capa {fmtMoney(ly.unit_cost)} / {selectedItem?.unit || 'u.base'}</span>
                            <br />
                            <span className="text-slate-600">
                              Ingreso: {String(ly.mov_date || '').slice(0, 10)}
                              {inboundParts.length ? ` · ${inboundParts.join(' · ')}` : ''}
                              {ly.inbound_pack_cost != null ? ` · Costo/envase ${Number(ly.inbound_pack_cost).toFixed(2)} ${ly.inbound_currency || 'CRC'}` : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="out-qty">
                    Cantidad a dar de baja ({selectedItem?.unit || 'base'})
                  </label>
                  <input
                    id="out-qty"
                    type="number"
                    step="0.001"
                    min="0.001"
                    max={selectedOutLayer ? Number(selectedOutLayer.qty_remaining) : undefined}
                    value={form.qty}
                    onChange={(e) => onFormChange('qty', e.target.value)}
                    className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    required
                  />
                  {selectedOutLayer ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Máximo en esta capa: {formatQtyWithUnit(selectedOutLayer.qty_remaining, selectedItem?.unit)}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-800">¿Le devolvieron dinero por esta mercadería?</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="out_has_refund"
                        checked={form.has_refund === 'no'}
                        onChange={() => setForm((prev) => ({ ...prev, has_refund: 'no', refund_crc: '' }))}
                      />
                      No
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="out_has_refund"
                        checked={form.has_refund === 'yes'}
                        onChange={() => setForm((prev) => ({ ...prev, has_refund: 'yes' }))}
                      />
                      Sí
                    </label>
                  </div>
                  {form.has_refund === 'yes' ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="out-refund">
                        Monto devuelto (colones, ₡)
                      </label>
                      <p className="mb-1 text-xs text-slate-500">
                        Escriba el total en colones que recibió de vuelta por esta salida (factura abonada, nota de
                        crédito, transferencia, etc.).
                      </p>
                      <input
                        id="out-refund"
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={form.refund_crc}
                        onChange={(e) => onFormChange('refund_crc', e.target.value)}
                        placeholder="Ej. 15000"
                        className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        required
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              {outCostPreview ? (
                <p className="text-xs text-slate-700">
                  Costo bruto de esta salida (según la capa): <strong>{fmtMoney(outCostPreview.gross)}</strong>
                  {outCostPreview.net != null ? (
                    <>
                      {' · '}
                      Costo neto en inventario (después del reintegro): <strong>{fmtMoney(outCostPreview.net)}</strong>
                    </>
                  ) : form.has_refund === 'yes' ? (
                    <span className="text-slate-600"> · Indique el monto en colones para calcular el costo neto.</span>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}
          {showNewItemForm ? (
            <div
              ref={inlineCreateRef}
              className="grid grid-cols-1 gap-2 rounded-xl border border-dashed border-lime-400 bg-lime-50/50 p-3 sm:grid-cols-4"
            >
              <p className="text-sm font-medium text-lime-900 sm:col-span-4">Nuevo insumo</p>
              <input
                value={newItemForm.name}
                onChange={(e) => setNewItemForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="Nombre insumo"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <select
                value={newItemForm.unit}
                onChange={(e) => setNewItemForm((p) => ({ ...p, unit: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="kg">kg</option>
                <option value="litro">litro</option>
                <option value="unidad">unidad</option>
              </select>
              <select
                value={newItemForm.category_id}
                onChange={(e) => setNewItemForm((p) => ({ ...p, category_id: e.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Categoría</option>
                {(itemMeta.categories || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <InventoryBrandCombo
                    valueId={newItemForm.brand_id}
                    fallbackName={newItemForm.brand_id ? newItemForm.brand_name : ''}
                    disabled={readOnly}
                    onBrandFieldsChange={({ brand_id, brand_name }) =>
                      setNewItemForm((p) => ({
                        ...p,
                        brand_id: brand_id || '',
                        brand_name: brand_name || '',
                      }))
                    }
                    onBrandsUpdated={() => loadMeta().catch(() => {})}
                  />
                </div>
                <button type="button" onClick={submitNewItem} className="shrink-0 rounded-lg bg-lime-700 px-3 py-2 text-sm font-semibold text-white">
                  Crear
                </button>
              </div>
            </div>
          ) : null}
          {form.movement !== 'out' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.pack_mode)}
                  onChange={(e) => onFormChange('pack_mode', e.target.checked)}
                />
                Registrar por bombas/pichingas u otro
              </label>
              <p className="mt-1 text-xs text-slate-500">
                El sistema convierte envases a unidad base del insumo antes de guardar.
              </p>
            </div>
          ) : null}
          {form.pack_mode && form.movement === 'in' ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                value={form.currency}
                onChange={(e) => onFormChange('currency', e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="CRC">CRC</option>
                <option value="USD">USD</option>
              </select>
              {form.currency === 'USD' ? (
                <input
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  value={form.fx_rate}
                  onChange={(e) => onFormChange('fx_rate', e.target.value)}
                  placeholder="Tipo cambio CRC/USD"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-500">
                  Moneda CRC (sin tipo de cambio)
                </div>
              )}
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.pack_cost}
                onChange={(e) => onFormChange('pack_cost', e.target.value)}
                placeholder={`Costo por envase (${form.currency})`}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>
          ) : null}
          {form.movement === 'adjust' ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-950">
              <p className="font-medium text-sky-900">Ajuste físico</p>
              <p className="mt-1 text-sky-900/90">
                Solo indique el <strong>conteo físico</strong> (por unidad base o por envase). El sistema compara con el
                stock actual y actualiza desde la capa más antigua (FIFO).
              </p>
            </div>
          ) : null}
          {form.pack_mode ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={form.pack_label}
                onChange={(e) => onFormChange('pack_label', e.target.value)}
                placeholder="Presentación (ej. Saco)"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={form.pack_count}
                onChange={(e) => onFormChange('pack_count', e.target.value)}
                placeholder="Cantidad envases"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              />
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={form.pack_size}
                onChange={(e) => onFormChange('pack_size', e.target.value)}
                placeholder="Tamaño por envase"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              />
              <select
                value={form.pack_unit}
                onChange={(e) => onFormChange('pack_unit', e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                required
              >
                <option value="">Unidad del insumo</option>
                <option value="kg">kg</option>
                <option value="gramo">gramo</option>
                <option value="onza_masa">Onza de masa (oz) — con kg/gramo</option>
                <option value="litro">litro</option>
                <option value="cc">cc</option>
                <option value="onza_liquida">Onza líquida (fl oz) — con litro/cc</option>
                <option value="unidad">unidad</option>
              </select>
            </div>
          ) : null}
          {form.movement !== 'out' ? (
            <div
              className={`grid grid-cols-1 gap-2 ${
                !form.pack_mode && form.movement === 'in' ? 'sm:grid-cols-4' : 'sm:grid-cols-1'
              }`}
            >
              <div
                className={
                  form.pack_mode
                    ? 'flex min-w-0 flex-wrap items-stretch gap-2 sm:flex-nowrap'
                    : 'contents'
                }
              >
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={
                    form.pack_mode
                      ? packDerivedQty == null
                        ? ''
                        : String(packDerivedQty)
                      : form.movement === 'adjust'
                        ? form.counted_qty
                        : form.qty
                  }
                  onChange={(e) => onFormChange(form.movement === 'adjust' ? 'counted_qty' : 'qty', e.target.value)}
                  placeholder={form.movement === 'adjust' ? 'Conteo físico' : `Cantidad (${selectedItem?.unit || 'base'})`}
                  className={
                    form.pack_mode
                      ? 'min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                      : 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
                  }
                  required
                  readOnly={Boolean(form.pack_mode)}
                />
                {form.pack_mode ? (
                  <span className="flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm font-medium text-slate-700">
                    {selectedItem?.unit || 'base'}
                  </span>
                ) : null}
              </div>
              {!form.pack_mode && form.movement === 'in' ? (
                <>
                  <select value={form.currency} onChange={(e) => onFormChange('currency', e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                    <option value="CRC">CRC</option>
                    <option value="USD">USD</option>
                  </select>
                  {form.currency === 'USD' ? (
                    <>
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={form.unit_cost}
                        onChange={(e) => onFormChange('unit_cost', e.target.value)}
                        placeholder="Costo unitario USD"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                      <input
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={form.fx_rate}
                        onChange={(e) => onFormChange('fx_rate', e.target.value)}
                        placeholder="Tipo cambio CRC/USD"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      />
                    </>
                  ) : (
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={form.unit_cost}
                      onChange={(e) => onFormChange('unit_cost', e.target.value)}
                      placeholder="Costo unitario CRC"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  )}
                </>
              ) : null}
            </div>
          ) : null}
          {form.pack_mode && form.movement === 'in' ? (
            <p className="text-xs text-slate-500">
              Cantidad base calculada en la unidad del insumo ({selectedItem?.unit || '—'}). Con litros usa onza líquida
              (1 L = 33,81 fl oz); con kg o gramos usa onza de masa (1 kg = 35,274 oz). En ingreso por envase: primero
              moneda y tipo de cambio (si aplica), luego costo por envase.
            </p>
          ) : null}
          {form.pack_mode && form.movement === 'adjust' ? (
            <p className="text-xs text-slate-500">
              Cantidad base del conteo en la unidad del insumo ({selectedItem?.unit || '—'}). Misma conversión de
              envases que en entradas; el costo lo estima el sistema según la capa más antigua.
            </p>
          ) : null}
          {form.currency === 'USD' && form.movement === 'in' && !form.pack_mode ? (
            <p className="text-xs text-slate-500">
              En USD debes indicar costo en USD (por unidad base) y tipo de cambio CRC/USD.
            </p>
          ) : null}
          <textarea
            value={form.notes}
            onChange={(e) => onFormChange('notes', e.target.value)}
            placeholder={
              form.movement === 'out'
                ? 'Observaciones obligatorias: motivo de la salida (vencido, mal estado, donación, etc.)'
                : 'Notas (opcional)'
            }
            required={form.movement === 'out'}
            className="min-h-[70px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={submitting || readOnly} className="rounded-lg bg-lime-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {submitting ? 'Guardando...' : 'Guardar movimiento'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewItemForm((v) => !v);
                setItemPickerOpen(false);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {showNewItemForm ? 'Ocultar alta rápida' : 'Crear insumo rápido'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-700">
            <tr>
              {['Fecha', 'Insumo', 'Tipo', 'Cantidad', 'Costo total', 'Notas', 'Estado', 'Acciones'].map((col) => (
                <th key={col} className="px-3 py-2 font-semibold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Cargando...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">Sin movimientos.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{String(r.mov_date || '').slice(0, 10)}</td>
                  <td className="px-3 py-2">{r.item_name}</td>
                  <td className="px-3 py-2">{r.movement === 'in' ? 'Entrada' : r.movement === 'out' ? 'Salida' : 'Ajuste'}</td>
                  <td className="px-3 py-2">{formatQtyWithUnit(r.qty, r.item_unit)}</td>
                  <td className="px-3 py-2">{fmtMoney(r.total_cost)}</td>
                  <td className="px-3 py-2">{r.notes || '—'}</td>
                  <td className="px-3 py-2">{r.is_active ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => openViewMovement(r)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        Ver
                      </button>
                      <button type="button" disabled={!canMutateMovementRow(r)} onClick={() => openEditModal(r)} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-60">Editar</button>
                      <button type="button" disabled={!canMutateMovementRow(r)} onClick={() => onToggleActive(r)} className={`rounded px-2 py-1 text-xs ${r.is_active ? 'border border-rose-300 bg-rose-50 text-rose-700' : 'border border-emerald-300 bg-emerald-50 text-emerald-700'} disabled:opacity-60`}>
                        {r.is_active ? 'Inactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editRow ? (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/50">
          <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-movement-title"
              className="my-6 flex w-full max-w-lg max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:max-h-[calc(100vh-4rem)]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <h5 id="edit-movement-title" className="text-sm font-semibold text-slate-900">
                  Editar movimiento
                </h5>
                <button type="button" onClick={closeEditModal} className="text-sm text-slate-500 hover:text-slate-800">
                  Cerrar
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 text-sm">
                <div className="space-y-3">
                  <p className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Solo puedes cambiar la <strong>fecha del movimiento</strong> y las <strong>notas</strong>. Cantidades,
                    costos, insumo y tipo no se modifican desde aquí (afectan capas FIFO y stock).
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Detail label="Insumo" value={`${editRow.item_name || '—'} (${editRow.item_unit || '—'})`} />
                    <Detail
                      label="Tipo"
                      value={editRow.movement === 'in' ? 'Entrada' : editRow.movement === 'out' ? 'Salida' : 'Ajuste'}
                    />
                    <Detail label="Cantidad" value={formatQtyWithUnit(editRow.qty, editRow.item_unit)} />
                    <Detail label="Costo total" value={fmtMoney(editRow.total_cost)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="edit-mov-date">
                      Fecha del movimiento
                    </label>
                    <input
                      id="edit-mov-date"
                      type="date"
                      value={editDraft.mov_date}
                      onChange={(e) => setEditDraft((d) => ({ ...d, mov_date: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="edit-mov-notes">
                      Notas
                    </label>
                    <textarea
                      id="edit-mov-notes"
                      value={editDraft.notes}
                      onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                      rows={4}
                      placeholder="Notas (opcional)"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                  {editSaveError ? (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{editSaveError}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={editSaving || (editRow && !canMutateMovementRow(editRow))}
                  onClick={saveEditModal}
                  className="rounded-lg bg-lime-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {editSaving ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {viewRow ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50">
          <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="movement-detail-title"
              className="my-6 flex w-full max-w-3xl max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:max-h-[calc(100vh-4rem)]"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                <h5 id="movement-detail-title" className="text-sm font-semibold text-slate-900">
                  Detalle de movimiento
                </h5>
                <button type="button" onClick={() => setViewRow(null)} className="text-sm text-slate-500 hover:text-slate-800">
                  Cerrar
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                {viewDetailLoading ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-600">Cargando detalle…</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2">
                  <Detail label="Fecha" value={String(viewRow.mov_date || '').slice(0, 10)} />
                  <Detail label="Tipo" value={viewRow.movement === 'in' ? 'Entrada' : viewRow.movement === 'out' ? 'Salida' : 'Ajuste'} />
                  {viewRow.movement === 'adjust' ? (
                    <Detail
                      label="Valorización del ajuste"
                      value="Montos estimados según la capa más antigua."
                    />
                  ) : null}
                  <Detail label="Insumo" value={`${viewRow.item_name || '—'} (${viewRow.item_unit || '—'})`} />
                  <Detail label="Estado" value={viewRow.is_active ? 'Activo' : 'Inactivo'} />
                  <Detail label="Cantidad base" value={`${Number(viewRow.qty || 0).toLocaleString('es-CR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${viewRow.item_unit || ''}`} />
                  <Detail label="Moneda" value={viewRow.currency || 'CRC'} />
                  <Detail label="Tipo de cambio" value={viewRow.fx_rate != null ? Number(viewRow.fx_rate).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '—'} />
                  <Detail label="Costo unitario CRC" value={viewRow.unit_cost != null ? fmtMoney(viewRow.unit_cost) : '—'} />
                  <Detail label="Costo total CRC (neto inventario)" value={viewRow.total_cost != null ? fmtMoney(viewRow.total_cost) : '—'} />
                  <Detail label="Costo unitario USD" value={viewRow.unit_cost_usd != null ? Number(viewRow.unit_cost_usd).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—'} />
                  <Detail label="Costo total USD" value={viewRow.total_cost_usd != null ? Number(viewRow.total_cost_usd).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—'} />
                  {viewRow.movement === 'out' ? (
                    <>
                      <Detail
                        label="¿Hubo reintegro de dinero?"
                        value={
                          Number(viewRow.out_refund_crc || 0) > 0
                            ? 'Sí'
                            : 'No'
                        }
                      />
                      <Detail
                        label="Costo bruto (valor capa)"
                        value={viewRow.out_gross_total_crc != null ? fmtMoney(viewRow.out_gross_total_crc) : '—'}
                      />
                      <Detail
                        label="Monto del reintegro (CRC)"
                        value={
                          Number(viewRow.out_refund_crc || 0) > 0
                            ? fmtMoney(viewRow.out_refund_crc)
                            : '—'
                        }
                      />
                    </>
                  ) : null}
                  <Detail label="Notas" value={viewRow.notes || '—'} />
                </div>
                {viewRow.movement === 'out' && viewRow.source_inbound_mov_date ? (
                  <div className="border-t border-slate-200 px-4 py-3">
                    <h6 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ingreso origen (lote)</h6>
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                      <Detail label="Fecha ingreso" value={String(viewRow.source_inbound_mov_date || '').slice(0, 10)} />
                      <Detail label="Tipo de envase" value={viewRow.source_inbound_pack_label || '—'} />
                      <Detail
                        label="Empaque"
                        value={
                          viewRow.source_inbound_pack_count != null && viewRow.source_inbound_pack_size != null
                            ? `${viewRow.source_inbound_pack_count}×${viewRow.source_inbound_pack_size} ${formatPackUnitLabel(viewRow.source_inbound_pack_unit)}`
                            : '—'
                        }
                      />
                      <Detail
                        label="Costo por envase (ingreso)"
                        value={
                          viewRow.source_inbound_pack_cost != null
                            ? `${Number(viewRow.source_inbound_pack_cost).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${viewRow.source_inbound_currency || ''}`
                            : '—'
                        }
                      />
                      <Detail label="Costo unitario CRC (ingreso)" value={viewRow.source_inbound_unit_cost_crc != null ? fmtMoney(viewRow.source_inbound_unit_cost_crc) : '—'} />
                      <Detail label="Costo total CRC (ingreso)" value={viewRow.source_inbound_total_cost_crc != null ? fmtMoney(viewRow.source_inbound_total_cost_crc) : '—'} />
                    </div>
                  </div>
                ) : null}
                {viewRow.movement !== 'out' ? (
                  <div className="border-t border-slate-200 px-4 py-3">
                    <h6 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Envase / presentación</h6>
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
                      <Detail label="Tipo de envase" value={viewRow.pack_label || '—'} />
                      <Detail label="Cantidad envases" value={viewRow.pack_count != null ? String(viewRow.pack_count) : '—'} />
                      <Detail label="Tamaño por envase" value={viewRow.pack_size != null ? String(viewRow.pack_size) : '—'} />
                      <Detail label="Unidad envase" value={formatPackUnitLabel(viewRow.pack_unit)} />
                      <Detail label="Costo por envase" value={viewRow.pack_cost != null ? `${Number(viewRow.pack_cost).toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${viewRow.currency || ''}` : '—'} />
                    </div>
                  </div>
                ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{value || '—'}</p>
    </div>
  );
}

