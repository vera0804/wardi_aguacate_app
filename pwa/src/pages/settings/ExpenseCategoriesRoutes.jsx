import { Route, Routes } from 'react-router-dom';
import ExpenseCategoriesLayout from './ExpenseCategoriesLayout.jsx';
import ExpenseCategoriesListPage from './ExpenseCategoriesListPage.jsx';
import ExpenseCategoryFormPage from './ExpenseCategoryFormPage.jsx';
import ExpenseCategoryViewPage from './ExpenseCategoryViewPage.jsx';

export default function ExpenseCategoriesRoutes() {
  return (
    <Routes>
      <Route element={<ExpenseCategoriesLayout />}>
        <Route index element={<ExpenseCategoriesListPage />} />
        <Route path="new" element={<ExpenseCategoryFormPage mode="create" />} />
        <Route path=":id/ver" element={<ExpenseCategoryViewPage />} />
        <Route path=":id" element={<ExpenseCategoryFormPage mode="edit" />} />
      </Route>
    </Routes>
  );
}
