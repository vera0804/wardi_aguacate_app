import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import { canAccessEstadisticas } from '../../layouts/dashboardMenuData.js';
import { fetchStatsOverview } from '../../services/statsApi.js';
import { apiRequest } from '../../services/api.js';
import { defaultDateRange } from './statsFormat.jsx';

export function useStatsOverview({ includeLowStockInRequest = true } = {}) {
  const { user } = useAuth();
  const def = defaultDateRange();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [farmId, setFarmId] = useState('');
  const [lotId, setLotId] = useState('');
  const [lowStock, setLowStock] = useState('10');
  const [farms, setFarms] = useState([]);
  const [lots, setLots] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const blocked = !canAccessEstadisticas(user);

  const loadFarms = useCallback(async () => {
    try {
      const rows = await apiRequest('/api/farms');
      setFarms(Array.isArray(rows) ? rows : []);
    } catch {
      setFarms([]);
    }
  }, []);

  const loadLots = useCallback(async (fid) => {
    if (!fid) {
      setLots([]);
      return;
    }
    try {
      const rows = await apiRequest(`/api/lots?farm_id=${encodeURIComponent(fid)}`);
      setLots(Array.isArray(rows) ? rows : []);
    } catch {
      setLots([]);
    }
  }, []);

  useEffect(() => {
    loadFarms();
  }, [loadFarms]);

  useEffect(() => {
    loadLots(farmId);
    if (!farmId) setLotId('');
  }, [farmId, loadLots]);

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const overview = await fetchStatsOverview({
        from,
        to,
        farmId: farmId || undefined,
        lotId: lotId || undefined,
        lowStockThreshold:
          includeLowStockInRequest && lowStock !== '' ? Number(lowStock) : undefined,
      });
      setData(overview);
    } catch (e) {
      setData(null);
      setError(e?.message || 'No se pudieron cargar las estadísticas.');
    } finally {
      setLoading(false);
    }
  }, [from, to, farmId, lotId, lowStock, includeLowStockInRequest]);

  useEffect(() => {
    if (!blocked) refresh();
  }, [blocked, refresh]);

  return {
    from,
    setFrom,
    to,
    setTo,
    farmId,
    setFarmId,
    lotId,
    setLotId,
    lowStock,
    setLowStock,
    farms,
    lots,
    data,
    loading,
    error,
    refresh,
    blocked,
  };
}
