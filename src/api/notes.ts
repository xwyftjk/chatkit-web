/**
 * Notes API: create, list, get, update, delete.
 */

import { fetchApi } from './client.js';

export type Note = {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type NotesListResponse = {
  items: Note[];
  next_page_token?: string;
};

export async function createNote(content: string): Promise<Note> {
  const res = await fetchApi('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Note>;
}

export async function listNotes(params?: {
  page_size?: number;
  page_token?: string;
  sort?: 'asc' | 'desc';
}): Promise<NotesListResponse> {
  const sp = new URLSearchParams();
  if (params?.page_size != null) sp.set('page_size', String(params.page_size));
  if (params?.page_token) sp.set('page_token', params.page_token);
  if (params?.sort) sp.set('sort', params.sort ?? 'desc');
  const res = await fetchApi(`/api/notes?${sp}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<NotesListResponse>;
}

export async function getNote(id: string): Promise<Note> {
  const res = await fetchApi(`/api/notes/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Note>;
}

export async function updateNote(id: string, content: string): Promise<Note> {
  const res = await fetchApi(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Note>;
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetchApi(`/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}
