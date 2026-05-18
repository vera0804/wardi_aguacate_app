import AppRouter from './AppRouter.jsx';
import { useOfflineSync } from './hooks/useOfflineSync.js';

export default function App() {
  useOfflineSync();
  return <AppRouter />;
}
