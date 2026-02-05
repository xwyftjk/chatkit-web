/**
 * Conversation store: current session_id, sessions list, messages (in-memory).
 */

import { create } from 'zustand';
import type { Session, Message } from '../api/conversation.js';

type ConversationState = {
  sessions: Session[];
  totalSessions: number;
  hasMoreSessions: boolean;
  currentSessionId: string | null;
  messages: Message[];
  hasMoreMessages: boolean;
  totalInSession: number;
  streamingContent: string | null;
  /** 在 setStreamingContent(null) 前调用，用于保留滚动位置（不自动往上滚） */
  onBeforeStreamEnd: (() => void) | null;
  setSessions: (sessions: Session[], total: number, hasMore: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setMessages: (messages: Message[], hasMore: boolean, totalInSession: number) => void;
  /** 在列表头部追加更早的消息（向上滚动加载更多） */
  prependMessages: (olderMessages: Message[], hasMore: boolean) => void;
  appendMessage: (msg: Message) => void;
  setStreamingContent: (content: string | null) => void;
  setOnBeforeStreamEnd: (fn: (() => void) | null) => void;
  appendStreamingContent: (chunk: string) => void;
  reset: () => void;
};

export const useConversationStore = create<ConversationState>((set) => ({
  sessions: [],
  totalSessions: 0,
  hasMoreSessions: false,
  currentSessionId: null,
  messages: [],
  hasMoreMessages: false,
  totalInSession: 0,
  streamingContent: null,
  onBeforeStreamEnd: null,

  setSessions(sessions, total, hasMore) {
    set({ sessions, totalSessions: total, hasMoreSessions: hasMore });
  },

  setCurrentSessionId(id) {
    set({ currentSessionId: id, messages: [], hasMoreMessages: false, totalInSession: 0, streamingContent: null });
  },

  setMessages(messages, hasMore, totalInSession) {
    set({ messages, hasMoreMessages: hasMore, totalInSession });
  },

  prependMessages(olderMessages, hasMore) {
    set((s) => ({
      messages: [...olderMessages, ...s.messages],
      hasMoreMessages: hasMore,
    }));
  },

  appendMessage(msg) {
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  setStreamingContent(content) {
    if (content === null) {
      const fn = useConversationStore.getState().onBeforeStreamEnd;
      fn?.();
    }
    set({ streamingContent: content });
  },

  setOnBeforeStreamEnd(fn) {
    set({ onBeforeStreamEnd: fn });
  },

  appendStreamingContent(chunk) {
    set((s) => ({ streamingContent: (s.streamingContent ?? '') + chunk }));
  },

  reset() {
    set({
      sessions: [],
      totalSessions: 0,
      hasMoreSessions: false,
      currentSessionId: null,
      messages: [],
      hasMoreMessages: false,
      totalInSession: 0,
      streamingContent: null,
    });
  },
}));
