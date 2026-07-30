import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  getCurrentUser,
  loginSiteUser,
  logoutSiteUser,
} from '../lib/siteAuth';
import type { SiteUser } from '../lib/siteAuth';


interface AuthContextValue {
  user: SiteUser | null;
  loading: boolean;
  refresh: () => Promise<SiteUser | null>;
  login: (identity: string, password: string) => Promise<SiteUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SiteUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await getCurrentUser();
      setUser(current);
      return current;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (identity: string, password: string) => {
    const current = await loginSiteUser(identity, password);
    setUser(current);
    return current;
  }, []);

  const logout = useCallback(async () => {
    await logoutSiteUser();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, login, logout }),
    [user, loading, refresh, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
