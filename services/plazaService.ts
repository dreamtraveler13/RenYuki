'use client';

import type { PlazaGame, PlazaGameSummary, SaveFile } from '../types';

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

export const listPlazaGames = async (): Promise<PlazaGameSummary[]> => {
  const data = await requestJson<{ games: PlazaGameSummary[] }>('/api/plaza/list', { method: 'GET' });
  return data.games || [];
};

export const getPlazaGame = async (id: string): Promise<PlazaGame> => {
  const data = await requestJson<{ game: PlazaGame }>(`/api/plaza/game?id=${encodeURIComponent(id)}`, { method: 'GET' });
  return data.game;
};

export const publishPlazaGame = async (save: SaveFile): Promise<PlazaGameSummary> => {
  const sanitized: SaveFile = {
    ...save,
    assets: {
      ...save.assets,
      music: {},
      voice: {},
    },
  };
  const data = await requestJson<{ game: PlazaGameSummary }>('/api/plaza/publish', {
    method: 'POST',
    body: JSON.stringify({ save: sanitized }),
  });
  return data.game;
};

export const deletePlazaGame = async (id: string): Promise<{ ok: boolean }> => {
  return await requestJson<{ ok: boolean }>('/api/plaza/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
};
