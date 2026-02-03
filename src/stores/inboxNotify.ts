/**
 * Inbox notification: badge (red dot on 消息) and toast (popup when new message arrives).
 */

import { create } from 'zustand';

type InboxNotifyState = {
  hasNewInbox: boolean;
  showToast: boolean;
  setInboxNew: () => void;
  clearInboxNew: () => void;
  dismissToast: () => void;
};

export const useInboxNotifyStore = create<InboxNotifyState>((set) => ({
  hasNewInbox: false,
  showToast: false,

  setInboxNew: () => set({ hasNewInbox: true, showToast: true }),

  clearInboxNew: () => set({ hasNewInbox: false, showToast: false }),

  dismissToast: () => set({ showToast: false }),
}));
