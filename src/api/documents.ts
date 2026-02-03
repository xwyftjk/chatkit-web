/**
 * Documents API: upload, list, search, get, delete.
 */

import { fetchApi } from './client.js';

export type DocumentItem = {
  id: string;
  name: string;
  originalName?: string;
  category?: string;
  mimeType?: string;
  fileSize?: string;
  storageUrl?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export type DocumentsListResponse = {
  items: DocumentItem[];
  next_page_token?: string;
  /** Total count (when returned by backend) */
  total?: number;
};

export async function uploadDocument(formData: FormData): Promise<DocumentItem> {
  const res = await fetchApi('/api/documents', {
    method: 'POST',
    headers: {}, // no Content-Type; browser sets multipart boundary
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<DocumentItem>;
}

export async function listDocuments(params?: {
  page_size?: number;
  page_token?: string;
  sort?: 'asc' | 'desc';
}): Promise<DocumentsListResponse> {
  const sp = new URLSearchParams();
  if (params?.page_size != null) sp.set('page_size', String(params.page_size));
  if (params?.page_token) sp.set('page_token', params.page_token);
  if (params?.sort) sp.set('sort', params.sort);
  const res = await fetchApi(`/api/documents?${sp}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<DocumentsListResponse>;
}

export async function searchDocuments(q: string, params?: { page_size?: number }): Promise<DocumentsListResponse> {
  const sp = new URLSearchParams({ q });
  if (params?.page_size != null) sp.set('page_size', String(params.page_size));
  const res = await fetchApi(`/api/documents/search?${sp}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<DocumentsListResponse>;
}

export async function getDocument(id: string): Promise<DocumentItem> {
  const res = await fetchApi(`/api/documents/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<DocumentItem>;
}

export async function deleteDocument(id: string): Promise<void> {
  const res = await fetchApi(`/api/documents/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}
