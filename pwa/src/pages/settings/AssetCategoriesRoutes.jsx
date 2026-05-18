import { Route, Routes } from 'react-router-dom';
import AssetCategoriesLayout from './AssetCategoriesLayout.jsx';
import AssetCategoriesListPage from './AssetCategoriesListPage.jsx';
import AssetCategoryFormPage from './AssetCategoryFormPage.jsx';
import AssetCategoryViewPage from './AssetCategoryViewPage.jsx';

export default function AssetCategoriesRoutes() {
  return (
    <Routes>
      <Route element={<AssetCategoriesLayout />}>
        <Route index element={<AssetCategoriesListPage />} />
        <Route path="new" element={<AssetCategoryFormPage mode="create" />} />
        <Route path=":id/ver" element={<AssetCategoryViewPage />} />
        <Route path=":id" element={<AssetCategoryFormPage mode="edit" />} />
      </Route>
    </Routes>
  );
}
