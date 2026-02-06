/**
 * SSE /events: single connection per sessionId; uses fetch + ReadableStream so we can send Authorization.
 * (EventSource cannot set custom headers, so GET /events would get 401 without this.)
 * On 401: clear tokens and dispatch auth:logout so app redirects to login (same as fetchApi).
 */

import { getApiBase, getAccessToken, clearTokens } from './client.js';
import { generateUUID } from './uuid.js';

export type EventSourceCallback = (data: { type?: string; [k: string]: unknown }) => void;

export interface SSEConnection {
  close: () => void;
}

/**
 * Create SSE connection to /events with Authorization header; returns { close } to abort.
 */
export function createEventSource(
  sessionId: string,
  onMessage: EventSourceCallback,
  onError?: () => void
): SSEConnection {
  const base = getApiBase();
  const url = `${base}/events?sessionId=${encodeURIComponent(sessionId)}`;
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    console.log('[Events] 连接 SSE', url);
  }

  const controller = new AbortController();
  const token = getAccessToken();
  const headers: Record<string, string> = {
    'Accept': 'text/event-stream',
    'X-Request-ID': generateUUID(),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  (async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
      if (!res.ok) {
        if (typeof window !== 'undefined' && import.meta.env.DEV) {
          console.warn('[Events] SSE 错误或断开', sessionId, res.status);
        }
        if (res.status === 401 && typeof window !== 'undefined') {
          clearTokens();
          window.dispatchEvent(new Event('auth:logout'));
        }
        onError?.();
        return;
      }
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        console.log('[Events] SSE 已连接', sessionId);
      }
      const reader = res.body?.getReader();
      if (!reader) {
        onError?.();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!raw || raw.startsWith(':')) continue;
            try {
              const data = JSON.parse(raw) as { type?: string; [k: string]: unknown };
              onMessage(data);
              if (typeof window !== 'undefined' && data.type !== undefined) {
                const preview = data.type === 'TEXT_MESSAGE_CHUNK' && typeof (data as { delta?: string }).delta === 'string'
                  ? ` delta=${((data as { delta: string }).delta).length}ch`
                  : '';
                console.log('[Events] 收到', data.type, preview);
              }
            } catch (e) {
              if (typeof window !== 'undefined') {
                console.warn('[Events] 解析 data 失败', raw?.slice(0, 80), e);
              }
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        console.warn('[Events] SSE 错误或断开', sessionId);
      }
      onError?.();
    }
  })();

  return {
    close: () => {
      controller.abort();
    },
  };
}
