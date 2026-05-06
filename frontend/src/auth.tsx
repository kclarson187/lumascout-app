import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { api, onUnauthorized } from './api';
import { router } from 'expo-router';

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
  plan?: 'free' | 'pro' | 'elite' | 'comp_pro' | 'comp_elite' | 'trial_pro' | 'trial_elite';
  limits?: {
    saves: number;
    private_spots: number;
    collections: number;
    advanced_filters: boolean;
    sell_packs: boolean;
    monthly_outbound_dms?: number;
    active_routes?: number;
    max_uploads?: number;
  };
  usage?: {
    saves: number;
    private_spots: number;
    collections: number;
    uploads?: number;
    outbound_threads_30d?: number;
  };
  // ─── Photographer profile fields (May 2026) ────────────────────────
  // Existing canonical names on the user document. Adding them to the
  // type so the new profile-setup screen can read prefill values
  // without `as any` casts. All optional — legacy users have nulls.
  years_experience?: number | null;
  service_radius_miles?: number | null;
  booking_available?: boolean | null;
  facebook_url?: string | null;
  tiktok_url?: string | null;
  available_for_second_shooter?: boolean | null;
  mentorship_available?: boolean | null;
  // Profile-completion flag (computed server-side; read-only here).
  profile_complete?: boolean;
  profile_completed_at?: string | null;
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
      // Kick off push-token registration the first time we authenticate each
      // launch. Runs on native only; silent on web + simulators.
      try {
        const { registerPushToken } = await import('./push');
        registerPushToken();
      } catch {}
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

  // Wire the api 401-handler so any expired-token failure clears local
  // auth state and bounces to login. Prevents the "silent failure loop"
  // App-Store reviewers regularly flag.
  useEffect(() => {
    onUnauthorized(() => {
      setUser(null);
      try { router.replace('/(auth)/login' as any); } catch {}
    });
  }, []);

  // Refresh user record whenever the app comes back to foreground. This
  // ensures admin-granted plan changes (comp_pro / comp_elite, role
  // promotions) propagate within seconds without forcing a logout.
  const lastRefreshRef = useRef<number>(0);
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') {
        const now = Date.now();
        // Throttle to at most once every 10s to avoid spam during quick
        // app-switching.
        if (now - lastRefreshRef.current > 10_000) {
          lastRefreshRef.current = now;
          refresh();
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [refresh]);

  const login = async (email: string, password: string) => {
    const data = await api.post('/auth/login', { email, password });
    await api.setToken(data.token);
    await refresh(); // Fetch full user data with plan, limits, usage
  };

  const register = async (email: string, password: string, name: string, specialties: string[] = []) => {
    const data = await api.post('/auth/register', { email, password, name, specialties });
    await api.setToken(data.token);
    await refresh(); // Fetch full user data with plan, limits, usage
  };

  const googleExchange = async (session_id: string) => {
    const data = await api.post('/auth/google/session', { session_id });
    await api.setToken(data.token);
    await refresh();
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
