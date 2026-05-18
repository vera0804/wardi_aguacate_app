import { Route, Routes } from 'react-router-dom';
import UsersSettingsLayout from './UsersSettingsLayout.jsx';
import UsersManagementPage from './UsersManagementPage.jsx';

export default function UsersSettingsRoutes() {
  return (
    <Routes>
      <Route element={<UsersSettingsLayout />}>
        <Route index element={<UsersManagementPage />} />
      </Route>
    </Routes>
  );
}
