import { Route, Routes } from 'react-router-dom';
import ChangePasswordLayout from './ChangePasswordLayout.jsx';
import ChangePasswordPage from './ChangePasswordPage.jsx';

export default function ChangePasswordSettingsRoutes() {
  return (
    <Routes>
      <Route element={<ChangePasswordLayout />}>
        <Route index element={<ChangePasswordPage />} />
      </Route>
    </Routes>
  );
}
