'use client';

// In-memory async task APIs served by our own Next routes (no database).
const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';
const withBase = (path: string) => `${API_BASE}${path}`;

type StatusResponse = { status: 'pending' | 'running' | 'done' | 'error'; error?: string | null };

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(withBase(path), {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as any)?.error) {
    throw new Error((data as any)?.error || `Request failed: ${res.status}`);
  }
  return data as T;
};

export const startEdgeTask = async (payload: Record<string, any>): Promise<string> => {
  const data = await requestJson<{ task_id: string }>('/api/tasks/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.task_id;
};

export const getEdgeTaskStatus = (taskId: string) =>
  requestJson<StatusResponse>(`/api/tasks/status?task_id=${encodeURIComponent(taskId)}`);

export const downloadEdgeTaskResult = async (taskId: string): Promise<Blob> => {
  const res = await fetch(withBase(`/api/tasks/download?task_id=${encodeURIComponent(taskId)}`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any)?.error || `Download failed: ${res.status}`);
  }
  return res.blob();
};

export const triggerJsonDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
