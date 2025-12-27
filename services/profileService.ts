'use client';

import type { CharacterProfile, CharacterRole, CharacterImages, PlazaRoleSummary } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';
const withBase = (path: string) => `${API_BASE}${path}`;

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(withBase(path), {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  const contentType = resp.headers.get('content-type') || '';
  let data: any = null;
  let text: string | null = null;

  try {
    if (contentType.includes('application/json')) {
      data = await resp.json();
    } else {
      text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {}
    }
  } catch {}

  const errorMessage =
    (data && typeof data === 'object' && typeof (data as any).error === 'string' && (data as any).error) ||
    (text && text.trim().length > 0 ? text.trim() : null) ||
    `Request failed: ${resp.status}`;

  if (!resp.ok || (data && typeof data === 'object' && (data as any).error)) {
    throw new Error(errorMessage);
  }

  return data as T;
};

export const listProfiles = async (): Promise<CharacterProfile[]> => {
  const data = await requestJson<{ profiles: CharacterProfile[] }>('/api/profiles/list', { method: 'GET' });
  return data.profiles || [];
};

export const createProfile = async (payload: {
  role: CharacterRole;
  name: string;
  images: CharacterImages;
}): Promise<CharacterProfile> => {
  const data = await requestJson<{ profile: CharacterProfile }>('/api/profiles/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.profile;
};

export const deleteProfile = async (id: string) => {
  return await requestJson<{ ok: boolean }>('/api/profiles/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
};

export const publishProfile = async (id: string): Promise<PlazaRoleSummary> => {
  const data = await requestJson<{ role: PlazaRoleSummary }>('/api/profiles/publish', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
  return data.role;
};
