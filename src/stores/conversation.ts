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
  setSessions: (sessions: Session[], total: number, hasMore: boolean) => void;
  setCurrentSessionId: (id: string | null) => void;
  setMessages: (messages: Message[], hasMore: boolean, totalInSession: number) => void;
  appendMessage: (msg: Message) => void;
  setStreamingContent: (content: string | null) => void;
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

  setSessions(sessions, total, hasMore) {
    set({ sessions, totalSessions: total, hasMoreSessions: hasMore });
  },

  setCurrentSessionId(id) {
    set({ currentSessionId: id, messages: [], hasMoreMessages: false, totalInSession: 0, streamingContent: null });
  },

  setMessages(messages, hasMore, totalInSession) {
    set({ messages, hasMoreMessages: hasMore, totalInSession });
  },

  appendMessage(msg) {
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  setStreamingContent(content) {
    set({ streamingContent: content });
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
