/**
 * Auth store: token, user_id, login, logout. Persist only tokens (optional).
 */

import { create } from 'zustand';
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  LoginPayload,
  RegisterPayload,
  LoginResponse,
} from '../api/auth.js';

type AuthState = {
  user_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  isLoading: boolean;
  error: string | null;
  setTokens: (r: LoginResponse, persist?: boolean) => void;
  login: (payload: LoginPayload, persist?: boolean) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  loadFromStorage: () => void;
};

const storage = {
  get(key: string): string | null {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  },
  set(key: string, value: string, persist: boolean) {
    (persist ? localStorage : sessionStorage).setItem(key, value);
  },
  remove(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user_id: null,
  access_token: null,
  refresh_token: null,
  isLoading: false,
  error: null,

  setTokens(r: LoginResponse, persist = false) {
    storage.set('access_token', r.access_token, persist);
    storage.set('refresh_token', r.refresh_token, persist);
    storage.set('user_id', r.user_id, persist);
    set({
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      user_id: r.user_id,
      error: null,
    });
  },

  async login(payload: LoginPayload, persist = false) {
    set({ isLoading: true, error: null });
    try {
      const res = await apiLogin(payload);
      get().setTokens(res, persist);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '登录失败' });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  async register(payload: RegisterPayload) {
    set({ isLoading: true, error: null });
    try {
      await apiRegister(payload);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '注册失败' });
      throw e;
    } finally {
      set({ isLoading: false });
    }
  },

  logout() {
    storage.remove('access_token');
    storage.remove('refresh_token');
    storage.remove('user_id');
    set({ user_id: null, access_token: null, refresh_token: null });
    apiLogout();
  },

  loadFromStorage() {
    const user_id = storage.get('user_id');
    const access_token = storage.get('access_token');
    const refresh_token = storage.get('refresh_token');
    if (access_token && user_id) {
      set({ user_id, access_token, refresh_token: refresh_token || null });
    }
  },
}));

// Restore login state from storage before first render (so ProtectedRoute sees it)
if (typeof window !== 'undefined') {
  useAuthStore.getState().loadFromStorage();
}
