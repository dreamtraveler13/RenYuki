'use client';

import { GeneratedAssets, GameScript, SaveFile, UserProfile } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

const withBase = (path: string) => `${API_BASE}${path}`;

const requestJson = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const resp = await fetch(withBase(path), {
    credentials: 'include',
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

export const saveGameServer = async (
  script: GameScript,
  assets: GeneratedAssets,
  userProfile: UserProfile,
  currentNodeId: string,
  affinity: number
): Promise<SaveFile> => {
  const data = await requestJson<{ save: SaveFile }>('/api/saves/save', {
    method: 'POST',
    body: JSON.stringify({ script, assets, userProfile, currentNodeId, affinity }),
  });
  return data.save;
};

export const getSaveListServer = async (): Promise<SaveFile[]> => {
  const data = await requestJson<{ saves: SaveFile[] }>('/api/saves/list', { method: 'GET' });
  return data.saves || [];
};

export const deleteSaveServer = async (id: number): Promise<void> => {
  await requestJson<{ ok: boolean }>('/api/saves/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
};

export const updateSaveAssetsServer = async (
  id: number,
  assets: GeneratedAssets
): Promise<SaveFile> => {
  const data = await requestJson<{ save: SaveFile }>('/api/saves/update', {
    method: 'POST',
    body: JSON.stringify({ id, assets }),
  });
  return data.save;
};

export const restoreSaveServer = async (save: SaveFile): Promise<SaveFile> => {
  const data = await requestJson<{ save: SaveFile }>('/api/saves/restore', {
    method: 'POST',
    body: JSON.stringify({ save }),
  });
  return data.save;
};
