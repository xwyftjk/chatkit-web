/**
 * Memory API: list, search, get by id, delete; temporal search/snapshot.
 */

import { fetchApi } from './client.js';

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'emotional';

export type Memory = {
  memory_id: string;
  user_id: string;
  memory_type: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at?: string;
  valid_from?: string;
  valid_to?: string | null;
};

export type MemoryListResponse = {
  memories: Memory[];
  total: number;
  has_more: boolean;
};

export type MemorySearchResponse = {
  memories: Array<Memory & { score?: number }>;
  count: number;
};

export type MemoryListParams = {
  limit?: number;
  offset?: number;
  memory_type?: MemoryType;
  /** 按会话筛选：只返回 metadata.session_id 等于该值的记忆（用于会话历史中展示“该消息产生的记忆”） */
  session_id?: string;
  /** 双时效筛选：记录时间 created_at 区间（YYYY-MM-DD） */
  created_after?: string;
  created_before?: string;
  /** 双时效筛选：事实时间 valid_from/valid_to 区间（YYYY-MM-DD） */
  fact_from?: string;
  fact_to?: string;
};

export async function listMemories(params?: MemoryListParams): Promise<MemoryListResponse> {
  const sp = new URLSearchParams();
  if (params?.limit != null) sp.set('limit', String(params.limit));
  if (params?.offset != null) sp.set('offset', String(params.offset));
  if (params?.memory_type) sp.set('memory_type', params.memory_type);
  if (params?.session_id?.trim()) sp.set('session_id', params.session_id.trim());
  if (params?.created_after?.trim()) sp.set('created_after', params.created_after.trim());
  if (params?.created_before?.trim()) sp.set('created_before', params.created_before.trim());
  if (params?.fact_from?.trim()) sp.set('fact_from', params.fact_from.trim());
  if (params?.fact_to?.trim()) sp.set('fact_to', params.fact_to.trim());
  const res = await fetchApi(`/api/memory?${sp}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<MemoryListResponse>;
}

export async function searchMemories(
  query: string,
  params?: { memory_types?: MemoryType[]; limit?: number; threshold?: number }
): Promise<MemorySearchResponse> {
  const res = await fetchApi('/api/memory/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      memory_types: params?.memory_types,
      limit: params?.limit ?? 10,
      threshold: params?.threshold ?? 0.5,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<MemorySearchResponse>;
}

export async function getMemoryById(memoryId: string): Promise<Memory> {
  const res = await fetchApi(`/api/memory/${encodeURIComponent(memoryId)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Memory>;
}

export async function deleteMemory(memoryId: string): Promise<{ memory_id: string; deleted: boolean }> {
  const res = await fetchApi(`/api/memory/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ memory_id: string; deleted: boolean }>;
}

/** Request body for POST /api/memory/ensure (explicit "remember this" from user). */
export type EnsureMemoryParams = {
  user_id: string;
  content: string;
  kind?: string;
  session_id?: string;
  source_message_id?: string;
};

/** Response from POST /api/memory/ensure. Operation is synchronous: backend waits for storage before returning. */
export type EnsureMemoryResponse = {
  /** saved = newly stored; updated = replaced conflicting; duplicate = already stored; blocked/consent_required = not stored. */
  status: 'saved' | 'updated' | 'duplicate' | 'blocked' | 'consent_required';
  reason: string;
  memory_id?: string;
  superseded_id?: string;
};

/** POST /api/memory/ensure - Save a memory explicitly (e.g. user clicks "请记住" on a message). */
export async function ensureMemory(params: EnsureMemoryParams): Promise<EnsureMemoryResponse> {
  const res = await fetchApi('/api/memory/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: params.user_id,
      content: params.content,
      kind: params.kind ?? 'fact',
      session_id: params.session_id,
      source_message_id: params.source_message_id,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<EnsureMemoryResponse>;
}

/** Coactivation edge from POST /api/hsg/coactivated */
export type CoactivationEdge = {
  memory_id_a: string;
  memory_id_b: string;
  strength: number;
  coactivation_count: number;
};

export type CoactivatedResponse = {
  memory_id: string;
  coactivated: CoactivationEdge[];
  count: number;
};

/** Get memories coactivated with the given memory (one layer of links). */
export async function getCoactivated(memoryId: string, limit = 30): Promise<CoactivatedResponse> {
  const res = await fetchApi('/api/hsg/coactivated', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory_id: memoryId, limit }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<CoactivatedResponse>;
}

export type MemoryWithHop = Memory & { hop?: number };

export type CoactivatedRelatedResponse = {
  memory_id: string;
  related: MemoryWithHop[];
  /** 从共激活图查到的 memory_id 列表（可能与 related 条数不一致：部分 id 在 Mem0 已删或属其他用户） */
  related_ids: string[];
  count: number;
};

/** GET /api/memory/by-id/{id}/coactivated - 获取共激活相关记忆（完整 Memory，支持 1～3 跳）. */
export async function getCoactivatedRelated(
  memoryId: string,
  opts?: { hops?: number; limit?: number }
): Promise<CoactivatedRelatedResponse> {
  const params = new URLSearchParams();
  if (opts?.hops != null) params.set('hops', String(opts.hops));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const url = `/api/memory/by-id/${encodeURIComponent(memoryId)}/coactivated${qs ? `?${qs}` : ''}`;
  const res = await fetchApi(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<CoactivatedRelatedResponse>;
}

/** 时序图谱实体（概念星图） */
export type TemporalEntity = {
  entity_id: string;
  user_id: string;
  entity_type: string;
  name: string;
  properties?: Record<string, unknown>;
  valid_from: string;
  valid_to?: string | null;
  transaction_time: string;
};

/** 实体间关系（用于关系图） */
export type TemporalRelation = {
  relation_id: string;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
};

export type TemporalSearchResponse = {
  entities: TemporalEntity[];
  relations: TemporalRelation[];
  count: number;
  total: number;
  as_of_date?: string;
};

export type TemporalSearchParams = {
  user_id: string;
  query?: string;
  as_of_date?: string;
  entity_types?: string[];
  limit?: number;
  offset?: number;
  /** 记录时间过滤 (YYYY-MM-DD)；后端据此过滤并分页 */
  transaction_after?: string;
  transaction_before?: string;
  /** 概念时间过滤 (YYYY-MM-DD)；后端据此过滤并分页 */
  fact_from?: string;
  fact_to?: string;
};

export async function temporalSearch(body: TemporalSearchParams): Promise<TemporalSearchResponse> {
  const res = await fetchApi('/api/temporal/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: body.user_id,
      query: body.query?.trim() || '',
      as_of_date: body.as_of_date,
      entity_types: body.entity_types,
      limit: body.limit ?? 50,
      offset: body.offset ?? 0,
      transaction_after: body.transaction_after || undefined,
      transaction_before: body.transaction_before || undefined,
      fact_from: body.fact_from || undefined,
      fact_to: body.fact_to || undefined,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<TemporalSearchResponse>;
}

export async function temporalSnapshot(body: { user_id?: string }): Promise<unknown> {
  const res = await fetchApi('/api/temporal/snapshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
