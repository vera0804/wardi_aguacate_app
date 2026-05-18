import { Routes, Route, Navigate } from 'react-router-dom';
import StatsLayout from './StatsLayout.jsx';
import StatsHubPage from './StatsHubPage.jsx';
import StatsResumenPage from './StatsResumenPage.jsx';
import StatsProduccionPage from './StatsProduccionPage.jsx';
import StatsCostosPage from './StatsCostosPage.jsx';
import StatsManoObraPage from './StatsManoObraPage.jsx';
import StatsInventarioPage from './StatsInventarioPage.jsx';
import StatsRentabilidadPage from './StatsRentabilidadPage.jsx';

export default function StatsRoutes() {
  return (
    <Routes>
      <Route element={<StatsLayout />}>
        <Route index element={<StatsHubPage />} />
        <Route path="resumen" element={<StatsResumenPage />} />
        <Route path="produccion" element={<StatsProduccionPage />} />
        <Route path="costos" element={<StatsCostosPage />} />
        <Route path="mano-obra" element={<StatsManoObraPage />} />
        <Route path="inventario" element={<StatsInventarioPage />} />
        <Route path="rentabilidad" element={<StatsRentabilidadPage />} />
        <Route path="*" element={<Navigate to="/stats" replace />} />
      </Route>
    </Routes>
  );
}
