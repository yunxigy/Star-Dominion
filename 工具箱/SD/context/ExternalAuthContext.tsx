import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface SiteUser {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
}

interface AuthContextValue {
  user: SiteUser | null;
  loading: boolean;
  refresh: () => Promise<SiteUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Browser client for an externally deployed authentication service. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SiteUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/auth-api/api/v1/session/me', { credentials: 'include' });
      if (!response.ok) { setUser(null); return null; }
      const current = await response.json() as SiteUser;
      setUser(current);
      return current;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const logout = useCallback(async () => {
    const csrfCookie = document.cookie.split(';').map(value => value.trim())
      .find(value => value.startsWith('sd_csrf='));
    const headers = new Headers();
    if (csrfCookie) headers.set('X-CSRF-Token', decodeURIComponent(csrfCookie.slice('sd_csrf='.length)));
    const response = await fetch('/auth-api/api/v1/session/logout', {
      method: 'POST', credentials: 'include', headers,
    });
    if (!response.ok && response.status !== 401) throw new Error('退出失败，请稍后重试');
    setUser(null);
  }, []);
  const value = useMemo(() => ({ user, loading, refresh, logout }), [user, loading, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
