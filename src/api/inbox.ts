/**
 * Inbox API: list items.
 */

import { fetchApi } from './client.js';

export type InboxItem = {
  inbox_item_id: string;
  message?: { role?: string; content?: string };
  metadata?: Record<string, unknown>;
  /** 投递渠道，如 ['inbox'] 仅通知、['inbox','ag-ui'] 为对话回复（存收件箱） */
  channels?: string[];
  stored_at?: string;
};

export type InboxListResponse = {
  items: InboxItem[];
  total: number;
  has_more: boolean;
};

export async function getInboxItems(
  userId: string,
  params?: { limit?: number; offset?: number; exclude_channels?: string }
): Promise<InboxListResponse> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  if (params?.exclude_channels != null) sp.set('exclude_channels', params.exclude_channels);
  const res = await fetchApi(
    `/inbox/${encodeURIComponent(userId)}/items?${sp}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<InboxListResponse>;
}
