import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import OfflineUnavailable from './OfflineUnavailable.jsx';

export default function OnlineOnlyRoute({ children }) {
  const online = useOnlineStatus();
  if (!online) {
    return <OfflineUnavailable fullPage />;
  }
  return children;
}
