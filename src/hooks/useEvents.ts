/**
 * SSE /events: connect for current sessionId; on session switch close and reopen.
 * Uses delayed cleanup + mount generation so React Strict Mode remount reuses one connection.
 */

import { useEffect, useRef } from 'react';
import { createEventSource } from '../api/events.js';
import { useConversationStore } from '../stores/conversation.js';
import { generateUUID } from '../api/uuid.js';

const CLEANUP_DELAY_MS = 120;

export function useEvents(
  sessionId: string | null,
  onAiChunk?: (data: { type?: string; content?: string; [k: string]: unknown }) => void,
  onInboxNew?: (data: { type?: string; content?: string; message?: { content?: string } | string; stored_at?: string; [k: string]: unknown }) => void
) {
  const esRef = useRef<{ close: () => void } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountIdRef = useRef(0);
  const onInboxNewRef = useRef(onInboxNew);
  const onAiChunkRef = useRef(onAiChunk);
  onInboxNewRef.current = onInboxNew;
  onAiChunkRef.current = onAiChunk;

  useEffect(() => {
    const mountId = ++mountIdRef.current;

    if (!sessionId) {
      if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      sessionIdRef.current = null;
      return;
    }

    if (cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current);
      cleanupTimerRef.current = null;
    }

    if (esRef.current && sessionIdRef.current === sessionId) {
      return;
    }

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    sessionIdRef.current = sessionId;
    console.log('[useEvents] 订阅 GET /events', { sessionId });
    const appendStreamingContent = useConversationStore.getState().appendStreamingContent;
    const appendMessage = useConversationStore.getState().appendMessage;
    const setStreamingContent = useConversationStore.getState().setStreamingContent;

    const es = createEventSource(
      sessionId,
      (data) => {
        const d = data as { type?: string; event?: string; content?: string; text?: string; delta?: string; finish_reason?: string };
        if (d.type === 'inbox.new') {
          onInboxNewRef.current?.(d);
          return;
        }
        if (d.type === 'TEXT_MESSAGE_CHUNK' && typeof d.delta === 'string') {
          appendStreamingContent(d.delta);
          onAiChunkRef.current?.(data);
          return;
        }
        if (d.type === 'message' || d.event === 'content' || d.content || d.text) {
          const content = d.content ?? d.text;
          if (typeof content === 'string') {
            appendStreamingContent(content);
            onAiChunkRef.current?.(data);
          }
          return;
        }
        if (d.type === 'RUN_FINISHED' || d.event === 'done' || d.finish_reason) {
          const fromStore = useConversationStore.getState().streamingContent ?? '';
          const fromEvent = typeof (d as { content?: string; text?: string; message?: string }).content === 'string'
            ? (d as { content: string }).content
            : typeof (d as { text?: string }).text === 'string'
              ? (d as { text: string }).text
              : '';
          const fullContent = fromEvent || fromStore;
          console.log('[useEvents] RUN_FINISHED/done', { fromStoreLen: fromStore.length, fromEventLen: fromEvent.length, fullContentLen: fullContent.length });
          appendMessage({
            message_id: generateUUID(),
            role: 'assistant',
            content: fullContent,
            timestamp: new Date().toISOString(),
          });
          setStreamingContent(null);
        }
      },
      () => {}
    );
    esRef.current = es;

    return () => {
      cleanupTimerRef.current = setTimeout(() => {
        cleanupTimerRef.current = null;
        if (mountIdRef.current !== mountId) return;
        if (esRef.current) {
          esRef.current.close();
          esRef.current = null;
        }
        sessionIdRef.current = null;
      }, CLEANUP_DELAY_MS);
    };
  }, [sessionId]);

  return { close: () => { if (cleanupTimerRef.current) clearTimeout(cleanupTimerRef.current); esRef.current?.close(); esRef.current = null; } };
}
