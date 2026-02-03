/**
 * Conversation API: sessions list, messages by session.
 */

import { fetchApi } from './client.js';

export type Session = {
  session_id: string;
  last_message_at: string;
  message_count: number;
  /** Preview of the last message (first ~120 chars), for session title */
  last_message?: string | null;
};

export type SessionsResponse = {
  sessions: Session[];
  total: number;
  has_more: boolean;
};

/** Minimal memory item when backend enriches messages with memories (GET /conversation/messages) */
export type MessageMemory = {
  memory_id: string;
  content: string;
  memory_type: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type Message = {
  message_id: string;
  role: string;
  content: string;
  timestamp: string;
  /** Memories produced from this message (when backend enriches with memory-store) */
  memories?: MessageMemory[];
};

export type MessagesResponse = {
  messages: Message[];
  has_more: boolean;
  total_in_session: number;
};

export async function getSessions(
  userId: string,
  limit = 20,
  offset = 0
): Promise<SessionsResponse> {
  const res = await fetchApi(
    `/conversation/sessions?user_id=${encodeURIComponent(userId)}&limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<SessionsResponse>;
}

export async function getMessages(
  sessionId: string,
  limit = 20,
  offset = 0
): Promise<MessagesResponse> {
  const res = await fetchApi(
    `/conversation/messages?session_id=${encodeURIComponent(sessionId)}&limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<MessagesResponse>;
}
