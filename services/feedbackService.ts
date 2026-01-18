'use client';

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

export const submitGameFeedback = async (payload: { content: string }) => {
  const data = await requestJson<{ ok: boolean }>('/api/feedback/submit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.ok;
};
