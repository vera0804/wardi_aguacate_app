import { Navigate, Route, Routes } from 'react-router-dom';
import ExpensesLayout from './ExpensesLayout.jsx';
import ExpensesWorkspace from './ExpensesWorkspace.jsx';
import ExpensesHistoryPage from './ExpensesHistoryPage.jsx';
import ExpenseRegisterPlaceholder from './ExpenseRegisterPlaceholder.jsx';
import GeneralExpenseDetailPage from './GeneralExpenseDetailPage.jsx';

export default function ExpensesRoutes() {
  return (
    <Routes>
      <Route element={<ExpensesLayout />}>
        <Route element={<ExpensesWorkspace />}>
          <Route index element={<Navigate to="historial" replace />} />
          <Route path="historial" element={<ExpensesHistoryPage />} />
          <Route path="registro/lote" element={<ExpenseRegisterPlaceholder kind="lote" />} />
          <Route path="registro/general" element={<ExpenseRegisterPlaceholder kind="general" />} />
        </Route>
        <Route path="general/:id" element={<GeneralExpenseDetailPage />} />
        <Route path="general" element={<Navigate to="historial" replace />} />
        <Route path="nuevo/*" element={<Navigate to="historial" replace />} />
      </Route>
    </Routes>
  );
}
