/**
 * API client: base URL, X-Request-ID, Authorization, 401 refresh/redirect.
 */

const getBaseUrl = (): string => {
  const u = import.meta.env.VITE_API_BASE_URL;
  return typeof u === 'string' && u.length > 0 ? u.replace(/\/$/, '') : '';
};

export function getApiBase(): string {
  return getBaseUrl();
}

export type RequestInitAuth = RequestInit & {
  skipAuth?: boolean;
  skipRequestId?: boolean;
};

export function getAccessToken(): string | null {
  return localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
}

function getRefreshToken(): string | null {
  return localStorage.getItem('refresh_token') || sessionStorage.getItem('refresh_token');
}

let refreshPromise: Promise<boolean> | null = null;

export async function refreshAccessToken(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': crypto.randomUUID(),
        },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          clearTokens();
          window.dispatchEvent(new Event('auth:logout'));
        }
        return false;
      }
      const data = (await res.json()) as {
        access_token: string;
        refresh_token: string;
        expires_in: number;
      };
      const storage = localStorage.getItem('refresh_token') ? localStorage : sessionStorage;
      storage.setItem('access_token', data.access_token);
      storage.setItem('refresh_token', data.refresh_token);
      return true;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export function clearTokens(): void {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user_id');
  sessionStorage.removeItem('access_token');
  sessionStorage.removeItem('refresh_token');
  sessionStorage.removeItem('user_id');
}

export async function fetchApi(
  path: string,
  init: RequestInitAuth = {}
): Promise<Response> {
  const { skipAuth = false, skipRequestId = false, headers = {}, ...rest } = init;
  const base = getBaseUrl();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const h: Record<string, string> = { ...(headers as Record<string, string>) };
  if (!skipRequestId) h['X-Request-ID'] = crypto.randomUUID();
  if (!skipAuth) {
    const token = getAccessToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
  }
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const token = getAccessToken();
    console.log('[API]', init.method ?? 'GET', path, skipAuth ? '(skipAuth)' : token ? 'Authorization: Bearer ***' : 'Authorization: (none)');
  }
  let res: Response;
  try {
    res = await fetch(url, { ...rest, headers: h });
  } catch (err) {
    if (typeof window !== 'undefined') {
      console.error('[API] 请求失败', path, err);
    }
    throw err;
  }
  if (res.status === 401 && !skipAuth) {
    if (getRefreshToken()) {
      const ok = await refreshAccessToken();
      if (ok) {
        const token = getAccessToken();
        if (token) h['Authorization'] = `Bearer ${token}`;
        res = await fetch(url, { ...rest, headers: h });
      }
    }
    // Persistent 401: clear auth so UI redirects to login (avoids repeated 401 / download prompt)
    if (res.status === 401 && typeof window !== 'undefined') {
      clearTokens();
      window.dispatchEvent(new Event('auth:logout'));
    }
  }
  return res;
}
