import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { isOfflineMenuLabel } from '../offline/offlineConfig.js';
import OfflineUnavailable from './OfflineUnavailable.jsx';

/** Bloquea el módulo si no es de los habilitados offline y no hay red. */
export default function OfflineModuleGate({ menuLabel, children }) {
  const online = useOnlineStatus();
  if (!online && !isOfflineMenuLabel(menuLabel)) {
    return <OfflineUnavailable />;
  }
  return children;
}
