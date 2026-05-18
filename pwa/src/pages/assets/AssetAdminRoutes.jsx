import { Route, Routes } from 'react-router-dom';
import AssetsLayout from './AssetsLayout.jsx';
import AssetsListPage from './AssetsListPage.jsx';
import AssetFormPage from './AssetFormPage.jsx';
import AssetViewPage from './AssetViewPage.jsx';
import AssetDepreciationPage from './AssetDepreciationPage.jsx';

export default function AssetAdminRoutes() {
  return (
    <Routes>
      <Route element={<AssetsLayout />}>
        <Route index element={<AssetsListPage />} />
        <Route path="new" element={<AssetFormPage mode="create" />} />
        <Route path=":id/ver" element={<AssetViewPage />} />
        <Route path=":id/depreciacion" element={<AssetDepreciationPage />} />
        <Route path=":id" element={<AssetFormPage mode="edit" />} />
      </Route>
    </Routes>
  );
}
