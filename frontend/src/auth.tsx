import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from './api';

export type User = {
  user_id: string;
  email: string;
  name: string;
  username: string;
  avatar_url?: string | null;
  bio?: string;
  city?: string;
  state?: string;
  specialties?: string[];
  website?: string;
  instagram?: string;
  role?: string;
  verification_status?: string;
  auth_provider?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, specialties?: string[]) => Promise<void>;
  googleExchange: (session_id: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (patch: Partial<User>) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await api.getTokenFromStorage();
      if (!token) {
        setUser(null);
        return;
      }
      const me = await api.get('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const data = await api.post('/auth/login', { email, password });
    await api.setToken(data.token);
    setUser(data.user);
  };

  const register = async (email: string, password: string, name: string, specialties: string[] = []) => {
    const data = await api.post('/auth/register', { email, password, name, specialties });
    await api.setToken(data.token);
    setUser(data.user);
  };

  const googleExchange = async (session_id: string) => {
    const data = await api.post('/auth/google/session', { session_id });
    await api.setToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    await api.setToken(null);
    setUser(null);
  };

  const updateProfile = async (patch: Partial<User>) => {
    const updated = await api.patch('/auth/me', patch);
    setUser(updated);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, googleExchange, logout, refresh, updateProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
