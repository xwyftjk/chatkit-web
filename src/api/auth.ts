/**
 * Auth API: register, login, refresh (refresh in client.ts).
 */

import { fetchApi, clearTokens } from './client.js';

export type LoginPayload = {
  email?: string;
  username?: string;
  phone_number?: string;
  password: string;
};

export type LoginResponse = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type RegisterPayload = {
  email?: string;
  phone_number?: string;
  password: string;
  name?: string;
  username?: string;
  code?: string;
};

export type RegisterResponse = {
  user_id: string;
  email?: string;
  email_verified?: boolean;
  message: string;
};

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const res = await fetchApi('/auth/login', {
    method: 'POST',
    skipAuth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const raw = await res.text();
  let data: { message?: string; error?: string } = {};
  try {
    if (raw) data = JSON.parse(raw) as { message?: string; error?: string };
  } catch {
    if (res.status >= 500) console.error('[Auth] 登录 500 原始响应:', raw.slice(0, 500));
  }
  if (!res.ok) {
    const msg = data.message || data.error || (res.status >= 500 ? `服务器错误 (${res.status})，请查看控制台` : `登录失败 (${res.status})`);
    if (res.status >= 500) console.error('[Auth] 登录 5xx:', res.status, data, raw.slice(0, 300));
    throw new Error(msg);
  }
  return data as LoginResponse;
}

export async function register(payload: RegisterPayload): Promise<RegisterResponse> {
  const res = await fetchApi('/auth/register', {
    method: 'POST',
    skipAuth: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message || '注册失败');
  return data as RegisterResponse;
}

export function logout(): void {
  clearTokens();
  window.dispatchEvent(new Event('auth:logout'));
}
