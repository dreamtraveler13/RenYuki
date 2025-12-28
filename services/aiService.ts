'use client';

import { GameGenerationInput, GameGenerationJobStatus, GameScript, SaveFile } from '../types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_RETRIES = 3;

const withBase = (path: string) => `${API_BASE}${path}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isRetriableClientError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|undici|5\d\d/i.test(msg);
};

const withRetry = async <T,>(label: string, fn: () => Promise<T>, tries = MAX_RETRIES): Promise<T> => {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetriableClientError(err) || attempt === tries) throw err;
      const delay = 400 * Math.pow(2, attempt - 1);
      console.warn(`${label} retry ${attempt}/${tries}:`, err);
      await sleep(delay);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
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
      } catch {
        // keep as text
      }
    }
  } catch {
    // ignore parse errors (we'll fall back to status-based error)
  }

  const errorMessage =
    (data && typeof data === 'object' && typeof (data as any).error === 'string' && (data as any).error) ||
    (text && text.trim().length > 0 ? text.trim() : null) ||
    `Request failed: ${resp.status}`;

  if (!resp.ok || (data && typeof data === 'object' && (data as any).error)) {
    throw new Error(errorMessage);
  }

  return data as T;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });

const downloadImageUrlToBase64 = async (url: string): Promise<string> => {
  return await withRetry('download-image', async () => {
    const resp = await fetch(withBase('/api/download-image'), {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `Download failed: ${resp.status}`);
    }
    const blob = await resp.blob();
    return await blobToBase64(blob);
  });
};

const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (err) => reject(err);
  });

const compressImageFile = (file: File, maxBytes: number): Promise<string> =>
  new Promise((resolve, reject) => {
    // 非图片或环境不支持时，直接走原始读取
    if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
      readFileAsBase64(file).then(resolve).catch(reject);
      return;
    }

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src.split(',')[1]);
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const toBase64FromBlob = (blob: Blob) => {
          const fr = new FileReader();
          fr.readAsDataURL(blob);
          fr.onload = () => {
            const result = fr.result as string;
            resolve(result.split(',')[1]);
          };
          fr.onerror = (err) => reject(err);
        };

        const tryCompress = (quality: number) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(src.split(',')[1]);
                return;
              }
              if (blob.size <= maxBytes || quality <= 0.2) {
                toBase64FromBlob(blob);
              } else {
                tryCompress(quality - 0.1);
              }
            },
            'image/jpeg',
            quality
          );
        };

        tryCompress(0.9);
      };
      img.onerror = () => {
        resolve(src.split(',')[1]);
      };
      img.src = src;
    };
    reader.onerror = (err) => reject(err);
  });

export const fileToBase64 = (file: File): Promise<string> => {
  if (file.size <= MAX_UPLOAD_BYTES) {
    return readFileAsBase64(file);
  }
  return compressImageFile(file, MAX_UPLOAD_BYTES);
};

export const generateGameScript = async (
  protagonistName: string,
  heroineName: string,
  plotDescription: string,
  maxMode: boolean = false,
  backgroundScenes?: Array<{ name: string; prompt: string }>
): Promise<GameScript> => {
  return await withRetry('generate-script', async () => {
    return await requestJson<GameScript>('/api/generate-script', {
      method: 'POST',
      body: JSON.stringify({
        protagonistName,
        heroineName,
        plotDescription,
        maxMode,
        ...(Array.isArray(backgroundScenes) && backgroundScenes.length > 0 ? { backgroundScenes } : {}),
      }),
    });
  });
};

export const inferScenes = async (plotDescription: string): Promise<Array<{ name: string; prompt: string }>> => {
  return await withRetry('infer-scenes', async () => {
    const data = await requestJson<{ scenes: Array<{ name: string; prompt: string }> }>('/api/infer-scenes', {
      method: 'POST',
      body: JSON.stringify({ plotDescription }),
    });
    const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
    if (scenes.length === 0) throw new Error('场景推测失败，请换个更具体的场景描述重试');
    return scenes;
  });
};

export const generateImage = async (prompt: string): Promise<string> => {
  return await withRetry('generate-image', async () => {
    const data = await requestJson<{ imageUrl: string }>('/api/generate-image', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    if (!data?.imageUrl) throw new Error('No imageUrl returned');
    return await downloadImageUrlToBase64(data.imageUrl);
  });
};

export const startGameGeneration = async (input: GameGenerationInput): Promise<{ jobId: string }> => {
  return await withRetry('generate-game', async () => {
    return await requestJson<{ jobId: string }>('/api/generate-game', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  });
};

export const getGameGenerationJob = async (
  jobId: string,
  opts?: { includeResult?: boolean; includeDebug?: boolean }
): Promise<GameGenerationJobStatus> => {
  const params = new URLSearchParams({ jobId });
  if (opts?.includeResult) params.set('includeResult', '1');
  if (opts?.includeDebug) params.set('includeDebug', '1');
  return await withRetry('generate-game-status', async () => {
    return await requestJson<GameGenerationJobStatus>(`/api/generate-game?${params.toString()}`);
  });
};

export const generateProtagonistSprite = async (
  emotion: string,
  userPhotoBase64?: string,
  referenceImageBase64?: string,
  mimeType: string = 'image/jpeg'
): Promise<string> => {
  if (!userPhotoBase64 && !referenceImageBase64) {
    throw new Error('需要上传照片作为参考');
  }
  return await withRetry('generate-protagonist', async () => {
    const data = await requestJson<{ imageUrl: string }>('/api/generate-protagonist', {
      method: 'POST',
      body: JSON.stringify({ emotion, userPhotoBase64, referenceImageBase64, mimeType }),
    });
    if (!data?.imageUrl) throw new Error('No imageUrl returned');
    return await downloadImageUrlToBase64(data.imageUrl);
  });
};

export const generateHeroineSprite = async (
  emotion: string,
  referenceImageBase64?: string,
  userPhotoBase64?: string,
  mimeType: string = 'image/jpeg'
): Promise<string> => {
  if (!userPhotoBase64 && !referenceImageBase64) {
    throw new Error('需要上传照片作为参考');
  }
  return await withRetry('generate-heroine', async () => {
    const data = await requestJson<{ imageUrl: string }>('/api/generate-heroine', {
      method: 'POST',
      body: JSON.stringify({ emotion, referenceImageBase64, userPhotoBase64, mimeType }),
    });
    if (!data?.imageUrl) throw new Error('No imageUrl returned');
    return await downloadImageUrlToBase64(data.imageUrl);
  });
};

export const generateHeroineVoice = async (text: string): Promise<string> => {
  return await withRetry('tts-heroine', async () => {
    const data = await requestJson<{ audioDataUrl: string; mimeType?: string }>('/api/tts', {
      method: 'POST',
      body: JSON.stringify({ text, voice: 'Cherry', languageType: 'Japanese' }),
    });
    if (!data?.audioDataUrl) throw new Error('No audioDataUrl returned');
    return data.audioDataUrl;
  });
};
