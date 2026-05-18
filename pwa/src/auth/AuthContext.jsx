import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import { apiRequest } from '../services/api.js';
import { syncOfflineCacheContext } from '../offline/offlineCacheScope.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    syncOfflineCacheContext(user).catch(() => {});
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await apiRequest('/api/auth/csrf');
        const profile = await apiRequest('/api/auth/me');
        if (!cancelled) {
          setUser(profile);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (identifier, password) => {
    const profile = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    });
    setUser(profile);
    return profile;
  }, []);

  const refreshProfile = useCallback(async () => {
    await apiRequest('/api/auth/csrf');
    const profile = await apiRequest('/api/auth/me');
    setUser(profile);
    return profile;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, setUser, login, refreshProfile, signOut, ready }),
    [user, login, refreshProfile, signOut, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return ctx;
}
