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

export type GenerationJobSummary = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'expired';
  progress: number;
  message: string;
  error?: string;
  refundedAt?: string;
  coinCost: number;
  resultSaveId?: number;
  downloadedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const listGenerationJobs = async (): Promise<GenerationJobSummary[]> => {
  const data = await requestJson<{ jobs: GenerationJobSummary[] }>('/api/generation-jobs/list', { method: 'GET' });
  return data.jobs || [];
};

export const retryGenerationJob = async (id: string): Promise<{ jobId: string }> => {
  return await requestJson<{ jobId: string }>('/api/generation-jobs/retry', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
};

export const markGenerationJobDownloaded = async (id: string): Promise<{ ok: true; downloadedAt: string | null }> => {
  return await requestJson<{ ok: true; downloadedAt: string | null }>('/api/generation-jobs/mark-downloaded', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
};
