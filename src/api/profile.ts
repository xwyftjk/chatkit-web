/**
 * Profile API: get, update.
 */

import { fetchApi } from './client.js';

export type Profile = {
  user_id: string;
  version?: number;
  updated_at?: string;
  risk_tolerance?: string;
  investment_horizon?: string;
  asset_preferences?: string[];
  asset_exclusions?: string[];
  life_events?: Array<{ type: string; date: string; description?: string }>;
  attributes?: Record<string, unknown>;
};

/** Backend returns 200 with empty profile (version 0) when no profile exists; return as-is so UI can show fixed fields with empty values. */
export async function getProfile(userId: string): Promise<Profile | null> {
  const res = await fetchApi(`/api/profile/${encodeURIComponent(userId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as Profile;
}

export async function updateProfile(userId: string, body: Partial<Profile>): Promise<Profile> {
  const res = await fetchApi(`/api/profile/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Profile>;
}
