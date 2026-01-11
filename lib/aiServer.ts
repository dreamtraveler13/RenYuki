import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { GameScript, SpeakerType, StoryNode } from '@/types';

const FALLBACK_BACKGROUND = 'General anime scene';

const JIEKOU_CHAT_BASE_URL = process.env.JIEKOU_CHAT_BASE_URL || 'https://api.jiekou.ai/openai';
const JIEKOU_IMAGE_ENDPOINT = process.env.JIEKOU_IMAGE_ENDPOINT || 'https://api.jiekou.ai/v3/seedream-4.5';
const JIEKOU_CHAT_MODEL = process.env.JIEKOU_CHAT_MODEL || 'gemini-2.5-flash';
const JIEKOU_BACKGROUND_IMAGE_SIZE = process.env.JIEKOU_BACKGROUND_IMAGE_SIZE || '2K';
const JIEKOU_SPRITE_IMAGE_SIZE = process.env.JIEKOU_SPRITE_IMAGE_SIZE || '';
const JIEKOU_DEVELOPER_MESSAGE = process.env.JIEKOU_DEVELOPER_MESSAGE || '你是一个有帮助的助手。';
const JIEKOU_FETCH_TIMEOUT_MS = Number(process.env.JIEKOU_FETCH_TIMEOUT_MS || 240_000);
const JIEKOU_IMAGE_TIMEOUT_MS = Number(process.env.JIEKOU_IMAGE_TIMEOUT_MS || 240_000);
const JIEKOU_IMAGE_DOWNLOAD_TIMEOUT_MS = Number(process.env.JIEKOU_IMAGE_DOWNLOAD_TIMEOUT_MS || 90_000);
const JIEKOU_BACKGROUND_IMAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.JIEKOU_BACKGROUND_IMAGE_CONCURRENCY || 16)
);
const JIEKOU_SPRITE_IMAGE_CONCURRENCY = Math.max(
  1,
  Number(process.env.JIEKOU_SPRITE_IMAGE_CONCURRENCY || 8)
);
const AI_DEBUG =
  process.env.AI_DEBUG === '1' || process.env.AI_DEBUG === 'true' || process.env.AI_DEBUG === 'yes';

type AiDebugEntry = {
  id: string;
  path: string;
  request: unknown;
  response?: unknown;
  error?: string;
  status?: number;
  stream?: boolean;
};

type AiDebugStore = {
  entries: AiDebugEntry[];
};

const aiDebugStorage = new AsyncLocalStorage<AiDebugStore>();

export const isAiDebugEnabled = () => AI_DEBUG;

export const withAiDebug = async <T,>(fn: () => Promise<T>): Promise<{ result: T; debug: AiDebugEntry[] | null }> => {
  if (!isAiDebugEnabled()) return { result: await fn(), debug: null };
  const store: AiDebugStore = { entries: [] };
  const result = await aiDebugStorage.run(store, fn);
  return { result, debug: store.entries };
};

export const withAiDebugStream = <T,>(
  fn: () => AsyncGenerator<T>
): { stream: AsyncGenerator<T>; debugStore: AiDebugStore | null } => {
  if (!isAiDebugEnabled()) return { stream: fn(), debugStore: null };
  const store: AiDebugStore = { entries: [] };
  const stream = aiDebugStorage.run(store, fn);
  return { stream, debugStore: store };
};

const getAiDebugStore = () => (isAiDebugEnabled() ? aiDebugStorage.getStore() : undefined);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const createSemaphore = (max: number) => {
  let active = 0;
  const queue: Array<() => void> = [];

  const acquire = async () => {
    if (active < max) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
  };

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    if (next) next();
  };

  const run = async <T>(fn: () => Promise<T>) => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };

  return { run };
};

const backgroundImageSemaphore = createSemaphore(JIEKOU_BACKGROUND_IMAGE_CONCURRENCY);
const spriteImageSemaphore = createSemaphore(JIEKOU_SPRITE_IMAGE_CONCURRENCY);

const isRetriableNetworkError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|undici/i.test(msg);
};

const isRetriableUpstreamMessage = (msg: string) =>
  /rate|429|temporar|timeout|overloaded|busy|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);

const withRetry = async <T>(
  fn: () => Promise<T>,
  opts: { tries: number; baseDelayMs: number; maxDelayMs: number; label: string }
) => {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= opts.tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const retriable = isRetriableNetworkError(err) || isRetriableUpstreamMessage(msg);
      if (!retriable || attempt === opts.tries) throw err;
      const backoff = Math.min(opts.maxDelayMs, Math.round(opts.baseDelayMs * Math.pow(2, attempt - 1)));
      const jitter = Math.round(backoff * (0.15 + Math.random() * 0.15));
      console.warn(`${opts.label}: retry ${attempt}/${opts.tries} after error: ${msg}`);
      await sleep(backoff + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

const guessMimeTypeFromBase64 = (base64: string, fallback: string) => {
  try {
    const header = Buffer.from(base64.slice(0, 64), 'base64');
    if (header.length >= 4) {
      // PNG
      if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) return 'image/png';
      // JPEG
      if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return 'image/jpeg';
      // WEBP (RIFF....WEBP)
      if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) return 'image/webp';
    }
  } catch {
    // ignore
  }
  return fallback || 'image/jpeg';
};

const DEFAULT_EMOTIONS: Array<StoryNode['emotion']> = ['normal', 'happy', 'surprised', 'angry', 'shy', 'sad'];

const normalizeEmotionKey = (raw: string) => {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (key === 'surprise') return 'surprised';
  if (key === 'neutral') return 'normal';
  return key;
};

const sanitizeEmotionList = (raw: unknown, fallback: Array<StoryNode['emotion']> = DEFAULT_EMOTIONS) => {
  if (!Array.isArray(raw)) return [...fallback];
  const allowed = new Set(DEFAULT_EMOTIONS);
  const cleaned = raw
    .map((item) => (typeof item === 'string' ? normalizeEmotionKey(item) : ''))
    .filter((item) => allowed.has(item as StoryNode['emotion'])) as Array<StoryNode['emotion']>;
  const uniq = Array.from(new Set(cleaned));
  if (uniq.length === 0) return [...fallback];
  if (!uniq.includes('normal')) uniq.unshift('normal');
  return uniq;
};

const ensureJiekouKey = () => {
  const key = process.env.JIEKOU_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('JIEKOU_API_KEY is missing. Set it in your server environment.');
  return key;
};

const getJiekouErrorMessage = (data: any) => {
  if (!data) return null;
  if (typeof data === 'string') return data;
  const error = (data as any).error;
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Upstream error';
  }
};

const resolveJiekouUrl = (pathOrUrl: string, baseUrl: string) => {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${baseUrl}${pathOrUrl}`;
};

const jiekouPostJson = async <T>(
  pathOrUrl: string,
  body: unknown,
  opts?: { timeoutMs?: number; baseUrl?: string }
): Promise<T> => {
  const apiKey = ensureJiekouKey();
  const baseUrl = opts?.baseUrl || JIEKOU_CHAT_BASE_URL;
  const url = resolveJiekouUrl(pathOrUrl, baseUrl);
  const ac = new AbortController();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? (opts!.timeoutMs as number) : JIEKOU_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ac.abort(), timeoutMs).unref?.();
  const debugStore = getAiDebugStore();
  const debugEntry: AiDebugEntry | null = debugStore
    ? { id: crypto.randomUUID(), path: pathOrUrl, request: body, stream: false }
    : null;
  if (debugEntry) debugStore!.entries.push(debugEntry);

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: ac.signal,
    });
  } catch (e: any) {
    const message = e?.message || 'fetch failed';
    if (debugEntry) debugEntry.error = message;
    throw new Error(message);
  } finally {
    clearTimeout(timer as any);
  }

  const rawText = await resp.text().catch(() => '');
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (debugEntry) debugEntry.status = resp.status;

  if (!resp.ok) {
    const message = getJiekouErrorMessage(data) || (rawText.trim().length > 0 ? rawText.trim() : null) || `Request failed: ${resp.status}`;
    if (debugEntry) {
      debugEntry.response = data || rawText;
      debugEntry.error = message;
    }
    throw new Error(message);
  }

  if (!data) {
    const ct = resp.headers.get('content-type') || 'unknown';
    const message = `Upstream returned empty/invalid JSON (status=${resp.status}, content-type=${ct})`;
    if (debugEntry) debugEntry.error = message;
    throw new Error(message);
  }

  // Some upstreams return 200 with an { error: ... } envelope.
  if (data && typeof data === 'object' && (data as any).error) {
    const message = getJiekouErrorMessage(data) || 'Upstream error';
    if (debugEntry) {
      debugEntry.response = data;
      debugEntry.error = message;
    }
    throw new Error(message);
  }

  if (debugEntry) debugEntry.response = data;
  return data as T;
};

type JiekouChatMessage = {
  role: 'developer' | 'user' | 'assistant' | 'model';
  content: string;
};

type JiekouChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string;
      refusal?: string | null;
    };
    text?: string;
  }>;
};

const getChatChoice = (response: JiekouChatCompletionResponse) => response.choices?.[0];

const getChatContent = (response: JiekouChatCompletionResponse) => {
  const choice = getChatChoice(response);
  return choice?.message?.content || choice?.text || '';
};

const isGeminiModel = (model = JIEKOU_CHAT_MODEL) => /\bgemini\b/i.test(model);

const buildChatMessages = (userContent: string): JiekouChatMessage[] => {
  const dev = typeof JIEKOU_DEVELOPER_MESSAGE === 'string' ? JIEKOU_DEVELOPER_MESSAGE.trim() : '';
  if (isGeminiModel()) {
    const merged = [dev, userContent].filter((s) => typeof s === 'string' && s.trim().length > 0).join('\n\n');
    return [{ role: 'user', content: merged }];
  }
  return [
    { role: 'developer', content: dev || 'You are a helpful assistant.' },
    { role: 'user', content: userContent },
  ];
};

const formatChatBlockedDetails = (response: JiekouChatCompletionResponse) => {
  const choice = getChatChoice(response);
  const refusal = choice?.message?.refusal;
  const finishReason = choice?.finish_reason;
  const contentLen = choice?.message?.content ? choice.message.content.length : 0;
  const textLen = choice?.text ? choice.text.length : 0;

  const details: string[] = [];
  if (typeof finishReason === 'string' && finishReason.length > 0) details.push(`finish_reason=${finishReason}`);
  if (typeof refusal === 'string' && refusal.length > 0) details.push(`refusal=${refusal}`);
  details.push(`content_len=${contentLen}`);
  details.push(`text_len=${textLen}`);
  return details.length > 0 ? ` (${details.join(', ')})` : '';
};


const jiekouChatCompletion = async (params: {
  messages: JiekouChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
}) =>
  jiekouPostJson<JiekouChatCompletionResponse>('/v1/chat/completions', {
    model: JIEKOU_CHAT_MODEL,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    stream: false,
    ...(params.response_format ? { response_format: params.response_format } : {}),
  });

const jiekouChatCompletionStream = async (params: {
  messages: JiekouChatMessage[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}) => {
  const apiKey = ensureJiekouKey();
  const body = {
    model: JIEKOU_CHAT_MODEL,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    stream: true,
  };
  const debugStore = getAiDebugStore();
  const debugEntry: AiDebugEntry | null = debugStore
    ? { id: crypto.randomUUID(), path: '/v1/chat/completions', request: body, stream: true }
    : null;
  if (debugEntry) debugStore!.entries.push(debugEntry);

  const resp = await fetch(resolveJiekouUrl('/v1/chat/completions', JIEKOU_CHAT_BASE_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: params.signal,
  });

  if (debugEntry) debugEntry.status = resp.status;

  if (!resp.ok) {
    const rawText = await resp.text().catch(() => '');
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }
    const message = getJiekouErrorMessage(data) || (rawText.trim().length > 0 ? rawText.trim() : null) || `Request failed: ${resp.status}`;
    if (debugEntry) {
      debugEntry.response = data || rawText;
      debugEntry.error = message;
    }
    throw new Error(message);
  }

  if (!resp.body) {
    const ct = resp.headers.get('content-type') || 'unknown';
    const message = `Upstream stream missing body (content-type=${ct})`;
    if (debugEntry) debugEntry.error = message;
    throw new Error(message);
  }

  return { resp, debugEntry };
};

type JiekouChatCompletionChunk = {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    message?: { role?: string; content?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
};

const getChunkDeltaContent = (chunk: JiekouChatCompletionChunk) =>
  chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || chunk.choices?.[0]?.text || '';

const parseStreamLineToChunkJson = (line: string): any | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const payload = trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : trimmed;
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

async function* jiekouChatCompletionDeltaStream(params: {
  messages: JiekouChatMessage[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const { resp, debugEntry } = await jiekouChatCompletionStream(params);
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let debugText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const rawLine of parts) {
      const obj = parseStreamLineToChunkJson(rawLine);
      if (!obj) continue;
      const delta = getChunkDeltaContent(obj as JiekouChatCompletionChunk);
      if (delta) {
        if (debugEntry) debugText += delta;
        yield delta;
      }
    }
  }

  if (buffer.trim()) {
    const obj = parseStreamLineToChunkJson(buffer);
    if (obj) {
      const delta = getChunkDeltaContent(obj as JiekouChatCompletionChunk);
      if (delta) {
        if (debugEntry) debugText += delta;
        yield delta;
      }
    }
  }

  if (debugEntry) debugEntry.response = debugText;
}

type SeedreamImagesGenerationResponse = {
  images?: string[];
};

const clampMaxImages = (requested: number, referenceCount: number) =>
  Math.max(1, Math.min(requested, Math.max(1, 15 - referenceCount)));

const seedreamImagesGeneration = async (params: {
  prompt: string;
  image?: string[];
  size?: string;
  sequential?: boolean;
  maxImages?: number;
}) =>
  withRetry(
    () => {
      const referenceCount = Array.isArray(params.image) ? params.image.length : 0;
      const maxImages = clampMaxImages(params.maxImages || 1, referenceCount);
      const payload: Record<string, any> = {
        prompt: params.prompt,
        sequential_image_generation: params.sequential ? 'auto' : 'disabled',
        watermark: false,
      };
      if (params.image && params.image.length > 0) payload.image = params.image;
      if (params.size) payload.size = params.size;
      if (params.sequential) {
        payload.sequential_image_generation_options = { max_images: maxImages };
      }

      return jiekouPostJson<SeedreamImagesGenerationResponse>(JIEKOU_IMAGE_ENDPOINT, payload, {
        timeoutMs: JIEKOU_IMAGE_TIMEOUT_MS,
      });
    },
    { tries: 3, baseDelayMs: 800, maxDelayMs: 6500, label: 'seedreamImagesGeneration' }
  );

const extractJSON = (text: string): any => {
  if (!text || typeof text !== 'string') throw new Error('Empty response from model');
  const tryParse = (raw: string) => {
    const cleaned = raw
      .replace(/```(?:json)?/gi, '') // drop code fences
      .replace(/,\s*([}\]])/g, '$1'); // strip trailing commas
    return JSON.parse(cleaned);
  };

  try {
    return tryParse(text);
  } catch (e) {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1) {
      const jsonStr = text.substring(first, last + 1);
      return tryParse(jsonStr);
    }
    throw new Error(`Failed to parse model JSON: ${(e as Error).message}`);
  }
};

// Some models accidentally output a full chat.completion-like envelope, or nest the JSON inside a string.
// This helper unwraps those cases to get the actual script payload containing `nodes` / `scene`.
const unwrapScriptPayload = (raw: any): any => {
  let current = raw;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== "object") break;
    if (current.nodes != null || current.scene != null) return current;

    const choice0 = Array.isArray((current as any).choices) ? (current as any).choices[0] : undefined;
    const candidate =
      (typeof (current as any).content === 'string' && (current as any).content) ||
      (typeof (current as any).message?.content === 'string' && (current as any).message.content) ||
      (typeof choice0?.message?.content === 'string' && choice0.message.content) ||
      (typeof choice0?.text === 'string' && choice0.text) ||
      undefined;

    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      try {
        current = extractJSON(candidate);
        continue;
      } catch {
        // fall through to nested object handling
      }
    }

    const nested =
      ((current as any).result && typeof (current as any).result === 'object' && (current as any).result) ||
      ((current as any).data && typeof (current as any).data === 'object' && (current as any).data) ||
      ((current as any).output && typeof (current as any).output === 'object' && (current as any).output) ||
      undefined;

    if (nested) {
      current = nested;
      continue;
    }

    break;
  }
  return current;
};

const normalizeNodes = (
  raw: any,
  opts?: {
    allowedBackgroundPrompts?: string[];
    allowedHeroineEmotions?: Array<StoryNode['emotion']>;
    allowedProtagonistEmotions?: Array<StoryNode['emotion']>;
  }
): { nodes: Record<string, StoryNode>; startNodeId: string } => {
  raw = unwrapScriptPayload(raw);
  const MIN_NODES = 6;
  const MAX_NODES = 18; // cap upper bound to reduce schema drift
  // Upstream sometimes returns alternative top-level keys (e.g. { scene: [...] }).
  let nodesValue: any = raw?.nodes ?? raw?.scene;
  if (typeof nodesValue === 'string') {
    try {
      nodesValue = JSON.parse(nodesValue);
    } catch {
      // ignore
    }
  }

  const rawNodes: any[] = Array.isArray(nodesValue)
    ? nodesValue
    : nodesValue && typeof nodesValue === 'object'
      ? Object.entries(nodesValue)
          .map(([id, node]) => {
            if (!node || typeof node !== 'object') return null;
            if (typeof (node as any).id === 'string') return node;
            return { id, ...(node as any) };
          })
          .filter(Boolean)
      : [];
  const allowedPromptsFromCaller =
    opts?.allowedBackgroundPrompts?.map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean) || [];
  const allowedPrompts: string[] = [];
  const allowedHeroineEmotions = sanitizeEmotionList(opts?.allowedHeroineEmotions);
  const allowedProtagonistEmotions = sanitizeEmotionList(opts?.allowedProtagonistEmotions);
  const allowedBgms = ['bgm_bossa', 'bgm_playful', 'bgm_piano', 'bgm_night', 'bgm_sad', 'bgm_dream', 'bgm_morning'];

  let sanitized: StoryNode[] = [];

  rawNodes.forEach((node: any, index: number) => {
    try {
      const idFromModel = typeof node.id === 'string' ? node.id.trim() : '';
      const id = idFromModel || `node-${index + 1}`;
      const textCN =
        typeof node.textCN === 'string'
          ? node.textCN.trim()
          : typeof node.text === 'string'
            ? node.text.trim()
            : typeof node.content === 'string'
              ? node.content.trim()
              : '';
      if (!id || !textCN) return;

      const speaker: StoryNode['speaker'] =
        node.speaker === 'Heroine'
          ? SpeakerType.HEROINE
          : node.speaker === 'Protagonist'
            ? SpeakerType.PROTAGONIST
            : SpeakerType.PROTAGONIST;

      const emotionRaw = typeof node.emotion === 'string' ? (node.emotion as StoryNode['emotion']) : 'normal';
      const allowedForSpeaker = speaker === SpeakerType.HEROINE ? allowedHeroineEmotions : allowedProtagonistEmotions;
      const fallbackEmotion = allowedForSpeaker.includes('normal') ? 'normal' : allowedForSpeaker[0] || 'normal';
      const emotion = allowedForSpeaker.includes(emotionRaw) ? emotionRaw : fallbackEmotion;

      const nodeTypeRaw = typeof node.nodeType === 'string' ? node.nodeType.trim() : '';
      const nodeType: StoryNode['nodeType'] =
        nodeTypeRaw === 'user_choice' || nodeTypeRaw === 'dialogue' || nodeTypeRaw === 'ending'
          ? (nodeTypeRaw as StoryNode['nodeType'])
          : undefined;

      let backgroundPrompt =
        typeof node.backgroundPrompt === 'string' && node.backgroundPrompt.trim().length > 0
          ? node.backgroundPrompt.trim()
          : FALLBACK_BACKGROUND;

      if (allowedPromptsFromCaller.length > 0) {
        if (!allowedPromptsFromCaller.includes(backgroundPrompt)) {
          backgroundPrompt = allowedPromptsFromCaller[0];
        }
      } else {
        if (!allowedPrompts.includes(backgroundPrompt)) {
          if (allowedPrompts.length < 3) {
            allowedPrompts.push(backgroundPrompt);
          } else {
            backgroundPrompt = allowedPrompts[0];
          }
        }
      }

      const bgm =
        typeof node.bgm === 'string' && allowedBgms.includes(node.bgm) ? (node.bgm as string) : undefined;

      let choices: StoryNode['choices'];
      if (Array.isArray(node.choices) && node.choices.length > 0) {
        const cleaned = node.choices
          .map((c: any) => {
            if (!c) return null;
            const text = typeof c.text === 'string' ? c.text.trim() : '';
            const nextNodeId = typeof c.nextNodeId === 'string' ? c.nextNodeId.trim() : '';
            const affinityScore =
              typeof c.affinityScore === 'number'
                ? c.affinityScore
                : Number.isFinite(Number(c.affinityScore))
                ? Number(c.affinityScore)
                : NaN;
            if (!text || !nextNodeId || Number.isNaN(affinityScore)) return null;
            return { text, nextNodeId, affinityScore };
          })
          .filter(Boolean);
        if (cleaned.length > 0) choices = cleaned as StoryNode['choices'];
      }

      const textJP = typeof node.textJP === 'string' ? node.textJP : undefined;
      const nextNodeId =
        typeof node.nextNodeId === 'string' && node.nextNodeId.trim().length > 0
          ? node.nextNodeId.trim()
          : undefined;

      sanitized.push({
        id,
        speaker,
        textCN,
        textJP,
        emotion,
        backgroundPrompt,
        bgm,
        choices,
        nextNodeId,
        nodeType,
      });
    } catch {
      // 单个节点异常时跳过，避免影响整体可玩性
    }
  });

  if (sanitized.length > MAX_NODES) {
    sanitized = sanitized.slice(0, MAX_NODES);
  }

  if (sanitized.length === 0) {
    throw new Error('Model returned no valid story nodes.');
  }

  // 二次遍历：补全缺失的 nextNodeId，并清理指向不存在节点的 choices
  const idOrder = sanitized.map((n) => n.id);
  const idSet = new Set(idOrder);

  sanitized.forEach((node, index) => {
    if (node.nextNodeId && !idSet.has(node.nextNodeId)) {
      delete node.nextNodeId;
    }

    if ((!node.choices || node.choices.length === 0) && !node.nextNodeId && index < sanitized.length - 1) {
      node.nextNodeId = sanitized[index + 1].id;
    }

    if (node.choices && node.choices.length > 0) {
      node.choices = node.choices.filter((c) => idSet.has(c.nextNodeId));
      if (node.choices.length === 0) {
        delete node.choices;
      }
    }
  });

  const nodesRecord: Record<string, StoryNode> = {};
  sanitized.forEach((node) => {
    nodesRecord[node.id] = node;
  });

  let startNodeId = raw.startNodeId;
  if (typeof startNodeId !== 'string' || !nodesRecord[startNodeId]) {
    startNodeId = sanitized[0].id;
  }

  if (sanitized.length < MIN_NODES) {
    throw new Error('Model returned too few usable nodes; please retry.');
  }

  return { nodes: nodesRecord, startNodeId };
};

const ensureUserChoiceTail = (script: GameScript): GameScript => {
  const nodesArray = Object.values(script.nodes);
  const last = nodesArray[nodesArray.length - 1];
  if (last && last.nodeType === 'user_choice') {
    const patched: StoryNode = {
      ...last,
      speaker: SpeakerType.HEROINE,
      textCN: typeof last.textCN === 'string' && last.textCN.trim().length > 0 ? last.textCN : '那……接下来你想怎么做？',
      textJP: typeof last.textJP === 'string' && last.textJP.trim().length > 0 ? last.textJP : 'じゃ阿……これから、どうする？',
      nextNodeId: undefined,
    };

    const changed =
      patched.speaker !== last.speaker ||
      patched.textCN !== last.textCN ||
      patched.textJP !== last.textJP ||
      patched.nextNodeId !== last.nextNodeId;

    if (!changed) return script;
    return { ...script, nodes: { ...script.nodes, [patched.id]: patched } };
  }

  const nodeId = `choice-${crypto.randomUUID()}`;
  const tail: StoryNode = {
    id: nodeId,
    speaker: SpeakerType.HEROINE,
    textCN: '那……接下来你想怎么做？',
    textJP: 'じゃ阿……これから、どうする？',
    emotion: 'normal',
    backgroundPrompt: last?.backgroundPrompt,
    bgm: last?.bgm,
    nextNodeId: undefined,
    nodeType: 'user_choice',
  };

  if (last && !last.nextNodeId && !(last as any).choices) {
    last.nextNodeId = nodeId;
  }

  return {
    ...script,
    nodes: {
      ...script.nodes,
      [nodeId]: tail,
    },
  };
};

const prefixNodeIds = (nodes: Record<string, StoryNode>) => {
  const prefix = `seg-${crypto.randomUUID()}`;
  const idMap = new Map<string, string>();
  for (const node of Object.values(nodes)) {
    idMap.set(node.id, `${prefix}-${node.id}`);
  }

  const remap = (id?: string) => (id && idMap.has(id) ? idMap.get(id)! : id);

  const out: Record<string, StoryNode> = {};
  for (const node of Object.values(nodes)) {
    const nextNodeId = remap(node.nextNodeId);
    const choices = node.choices?.map((c) => ({ ...c, nextNodeId: remap(c.nextNodeId)! }));
    const newId = idMap.get(node.id)!;
    out[newId] = { ...node, id: newId, nextNodeId, choices };
  }
  return out;
};

export type BackgroundScene = {
  name: string;
  prompt: string;
};

export type EmotionGuide = {
  heroineEmotions?: Array<StoryNode['emotion']>;
  protagonistEmotions?: Array<StoryNode['emotion']>;
  hasProtagonistSprite?: boolean;
};

const sanitizeBackgroundScenes = (raw: any): BackgroundScene[] => {
  const asArray: any[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw.scenes ?? raw.backgrounds ?? raw.items ?? []) : [];
  const items: BackgroundScene[] = asArray
    .map((item) => {
      if (typeof item === 'string') {
        const name = item.trim();
        return name ? { name, prompt: name } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const name = typeof item.name === 'string' ? item.name.trim() : typeof item.title === 'string' ? item.title.trim() : '';
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : typeof item.description === 'string' ? item.description.trim() : '';
      if (!name) return null;
      return { name, prompt: prompt || name };
    })
    .filter(Boolean) as BackgroundScene[];

  const seen = new Set<string>();
  const deduped: BackgroundScene[] = [];
  for (const scene of items) {
    const key = scene.name;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(scene);
    if (deduped.length >= 3) break;
  }
  return deduped;
};

export const inferBackgroundScenes = async (plotDescription: string): Promise<BackgroundScene[]> => {
  const userScene = typeof plotDescription === 'string' ? plotDescription.trim() : '';
  const prompt = `
    You are a Japanese school romance visual novel (Galgame) director.
    TASK: Infer the most likely BACKGROUND SCENES that will appear in the story based on the user's scene description.

    RULES (STRICT):
    - Output 1 to 3 scenes ONLY. Do NOT exceed 3.
    - Focus on the PHYSICAL ROUTE the characters will pass through, not camera angles or sub-areas of the same place.
      Example: "散步去小卖部" => ["校园", "小卖部"] (NOT "校园", "校园另一处", "小卖部").
    - Do NOT split a single location into multiple variants like "校园/校园另一处/校园小路".
    - Scenes must be distinct physical locations.
    - Each scene must have:
      - "name": short Chinese scene name, e.g. "校园", "小卖部", "天台", "走廊".
      - "prompt": a background prompt describing location + time-of-day + atmosphere, WITHOUT characters, WITHOUT text/UI, WITHOUT watermark.
    - Prefer Japanese high school romance settings.
    - Avoid overly abstract prompts. Keep them usable for background generation.

    USER SCENE DESCRIPTION:
    "${userScene || '（空）'}"

    OUTPUT FORMAT (RAW JSON ONLY):
    {"scenes":[{"name":"校园","prompt":"Japanese high school campus walkway after school, warm sunset, no characters, no text"}]}
  `;

  const response = await jiekouChatCompletion({
    messages: buildChatMessages(prompt),
    temperature: 0.2,
    max_tokens: 1024,
  });
  const rawText = getChatContent(response);
  if (!rawText || rawText.trim().length === 0) {
    throw new Error(`AI Generation Blocked${formatChatBlockedDetails(response)}`);
  }

  const raw = extractJSON(rawText);
  const scenes = sanitizeBackgroundScenes(raw);
  if (scenes.length === 0) throw new Error('场景推测失败：模型未返回可用场景');
  return scenes;
};

export const generateScript = async (
  protagonistName: string,
  heroineName?: string,
  plotDescription?: string,
  opts?: { backgroundScenes?: BackgroundScene[]; emotionGuide?: EmotionGuide }
): Promise<GameScript> => {
  const targetHeroine = heroineName ? heroineName.trim() : 'Yuki';
  const customPlot = plotDescription ? `Specific Situation: "${plotDescription}"` : 'A fateful encounter at school.';
  const backgroundScenes = sanitizeBackgroundScenes(opts?.backgroundScenes || []);
  const allowedBackgroundNames = backgroundScenes.map((s) => s.name);
  const heroineEmotions = sanitizeEmotionList(opts?.emotionGuide?.heroineEmotions);
  const protagonistEmotionsRaw = sanitizeEmotionList(opts?.emotionGuide?.protagonistEmotions);
  const hasProtagonistSprite = opts?.emotionGuide?.hasProtagonistSprite ?? true;
  const protagonistEmotions = hasProtagonistSprite ? protagonistEmotionsRaw : heroineEmotions;
  const backgroundGuide =
    backgroundScenes.length > 0
      ? `

    AVAILABLE BACKGROUNDS (MUST choose from this list ONLY):
    ${backgroundScenes.map((s) => `- ${s.name}: ${s.prompt}`).join('\n')}

    IMPORTANT:
    - For each node.backgroundPrompt, output EXACTLY one of the scene NAMES from the list above (e.g. "${backgroundScenes[0].name}").
    - Do NOT invent new background names.
  `
      : '';
  const emotionGuide = `
    SPRITE EMOTION AVAILABILITY (STRICT):
    - Heroine expressions: ${heroineEmotions.join(', ')}
    - Protagonist expressions: ${
      hasProtagonistSprite
        ? protagonistEmotions.join(', ')
        : `NOT AVAILABLE (use heroine list for any protagonist line): ${heroineEmotions.join(', ')}`
    }
    - For each node, the "emotion" MUST be chosen from the list that matches its speaker.
  `;
  const prompt = `
    You are the LEAD SCENARIO WRITER for a Japanese school romance visual novel (Galgame), like Senren * Banka (千恋＊万花).
    MISSION: Create a DEEP, immersive, and emotionally intense scene.
    MODE: Episodic. Generate the FIRST EPISODE only (we will continue later via player input).
    GENRE: School Romance / Slice of Life / Youth / Moe-ge.
    TARGET AUDIENCE: Otaku who love sweet, doki-doki, and comedic moments.
    THEME: Youth campus love story. Keep it wholesome and PG-16.

    CHARACTERS:
    1. ${protagonistName} (Protagonist): A high school student.
    2. ${targetHeroine} (Heroine): The main love interest. Deeply cares about ${protagonistName}.

    PLOT: ${customPlot}
    ${backgroundGuide}

    DIALOGUE STYLE (VERY IMPORTANT):
    - The Heroine must sound like a shy anime girl in a real galgame: flustered, sweet, cute.
    - Use classic galgame beats: small misunderstandings, heart-thumping moments, cute teasing, gentle intimacy.
    - Example (style reference, do NOT copy verbatim):
      - CN: 「你、你突然这么认真……会让我误会的啦……」/「那、那你要不要……放学一起走？」 
      - JP: 「そ、そんなに真剣に見ないでよ……勘違いしちゃう……」/「ね、ねえ……放課後、一緒に帰らない？」

    VISUAL & AUDIO DIRECTION:
    ${emotionGuide}
    - BACKGROUNDS (SCENE CONTROL, VERY IMPORTANT):
      - DEFAULT: Keep the same background for many consecutive nodes; The background only changes when the male and female leads physically move..
      - SCENE SWITCH RULE: ONLY change background when BOTH the Protagonist and the Heroine clearly move to a different physical location (for example: classroom → rooftop, school → home).
      - DO NOT change background just for mood, angle, or small actions. Treat location changes as rare, important events.
      - Overall goal: As few distinct scenes as possible while keeping the story coherent.
      - Prefer Japanese school settings: classroom, corridor, courtyard, club room, rooftop, school gate.
    - BGM: Select appropriate 'bgm' from: 'bgm_bossa', 'bgm_playful', 'bgm_piano', 'bgm_night', 'bgm_sad', 'bgm_dream', 'bgm_morning'.

    WRITING GUIDELINES (STRICT):
    - LENGTH: The story MUST be substantial.
    - DIALOGUE: Heroine must sound like a classic Anime Girl.
    - PACING: Slow burn.

    TECHNICAL REQUIREMENTS:
    - Nodes: Generate between 8 and 12 STORY NODES. Do NOT exceed 12 nodes.
    - Language: textCN (Chinese), textJP (Japanese for Heroine).
    - OUTPUT FORMAT: RAW JSON ONLY.
      - The ENTIRE response must be a single valid JSON object, no markdown, no code fences, no comments, no extra text.
      - The JSON must strictly follow the schema, no trailing commas and correct value types.
      - IMPORTANT: Use the TOP-LEVEL KEY "nodes" (NOT "scene").
      - IMPORTANT: Every node MUST include a unique string "id".
      - IMPORTANT: The LAST node MUST be a user input decision point:
        - Set "nodeType" to "user_choice"
        - The LAST node MUST be spoken by the Heroine and MUST be a question in classic galgame style

    SCHEMA CONSTRAINTS:
    - speaker: "Heroine" or "Protagonist".
    - emotion: MUST be chosen from the available expressions for the current speaker (see Sprite Emotion Availability).

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Treat emotion as a "segment-level" choice: keep the same emotion for a whole beat/paragraph of dialogue.
    - For each speaker, keep the same emotion for at least 2–4 consecutive nodes; only change when there is a clear emotional turn.
    - In back-and-forth conversation, avoid changing the heroine emotion every line; keep it stable across multiple exchanges.
    - Default to "normal"; use other emotions only for key beats (confession, embarrassment spike, surprise reveal, etc.).
  `;

  const scriptJsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      heroineName: { type: 'string' },
      startNodeId: { type: 'string' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            speaker: { type: 'string', enum: ['Heroine', 'Protagonist'] },
            textCN: { type: 'string' },
            textJP: { type: ['string', 'null'] },
            emotion: { type: 'string', enum: ['normal', 'happy', 'surprised', 'angry', 'shy', 'sad'] },
            backgroundPrompt: { type: ['string', 'null'] },
            bgm: {
              anyOf: [
                {
                  type: 'string',
                  enum: ['bgm_bossa', 'bgm_playful', 'bgm_piano', 'bgm_night', 'bgm_sad', 'bgm_dream', 'bgm_morning'],
                },
                { type: 'null' },
              ],
            },
            nextNodeId: { type: ['string', 'null'] },
            choices: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      text: { type: 'string' },
                      nextNodeId: { type: 'string' },
                      affinityScore: { type: 'number' },
                    },
                    required: ['text', 'nextNodeId', 'affinityScore'],
                  },
                },
                { type: 'null' },
              ],
            },
          },
        },
      },
    },
    required: ['title', 'heroineName', 'startNodeId', 'nodes'],
  };

  const callScriptChat = async (params: { temperature: number; response_format?: any }) =>
    jiekouChatCompletion({
      messages: buildChatMessages(prompt),
      temperature: params.temperature,
      max_tokens: 8192,
      response_format: params.response_format,
    });

  const generateOnce = async (temperature: number) => {
    const first = await callScriptChat({ temperature });
    let rawText = getChatContent(first);
    if (!rawText || rawText.trim().length === 0) {
      throw new Error(`AI Generation Blocked${formatChatBlockedDetails(first)}`);
    }

    let rawData = extractJSON(rawText);

    const { nodes, startNodeId } = normalizeNodes(
      rawData,
      allowedBackgroundNames.length > 0
        ? {
            allowedBackgroundPrompts: allowedBackgroundNames,
            allowedHeroineEmotions: heroineEmotions,
            allowedProtagonistEmotions: protagonistEmotions,
          }
        : {
            allowedHeroineEmotions: heroineEmotions,
            allowedProtagonistEmotions: protagonistEmotions,
          }
    );

    return {
      title: typeof rawData.title === 'string' && rawData.title.trim().length > 0 ? rawData.title.trim() : 'RenYuki Story',
      heroineName: rawData.heroineName || targetHeroine,
      startNodeId,
      nodes,
    } satisfies GameScript;
  };

  let result: GameScript;
  try {
    result = await generateOnce(0.6);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/no valid story nodes|too few usable nodes/i.test(message)) throw err;
    console.warn(`Retrying script generation due to invalid node structure: ${message}`);
    result = await generateOnce(0.2);
  }

  return ensureUserChoiceTail(result);
};

export type ContinueStoryStreamEvent =
  | { type: 'affinity'; delta: number; ending: boolean }
  | { type: 'node'; node: StoryNode }
  | { type: 'done' }
  | { type: 'error'; error: string };

export async function* continueStoryStream(params: {
  protagonistName: string;
  heroineName: string;
  userChoiceText: string;
  affinity?: number;
  allowedBackgroundPrompts: string[];
  allowedHeroineEmotions?: Array<StoryNode['emotion']>;
  allowedProtagonistEmotions?: Array<StoryNode['emotion']>;
  hasProtagonistSprite?: boolean;
  recentDialogue: Array<{ speaker: string; textCN: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<ContinueStoryStreamEvent> {
  const { protagonistName, heroineName, userChoiceText, affinity, allowedBackgroundPrompts, recentDialogue, signal } = params;
  const heroineEmotions = sanitizeEmotionList(params.allowedHeroineEmotions);
  const protagonistEmotionsRaw = sanitizeEmotionList(params.allowedProtagonistEmotions);
  const hasProtagonistSprite = params.hasProtagonistSprite ?? true;
  const protagonistEmotions = hasProtagonistSprite ? protagonistEmotionsRaw : heroineEmotions;

  const backgrounds = allowedBackgroundPrompts.length > 0 ? allowedBackgroundPrompts : [FALLBACK_BACKGROUND];
  const historyText = recentDialogue
    .slice(-12)
    .map((n) => `${n.speaker}: ${n.textCN}`)
    .join('\n');

  const affectionHint =
    typeof affinity === 'number'
      ? `Relationship sync is ${affinity}/100. Reflect it subtly in tone and intimacy, keep it PG-13.`
      : '';

  const prompt = `
    You are the LEAD SCENARIO WRITER for a Japanese school romance visual novel (Galgame), like Senren * Banka (千恋＊万花).
    Continue the story from the given context and the player's selected option.

    STORY ARC (VERY IMPORTANT):
    - Write as a complete Japanese school romance galgame with a clear beginning → development → climax → resolution.
    - Each continuation should progress the relationship and the overall plot (青春校园恋爱).
    - Decide an "affinityDelta" that reflects how this player option affects the heroine's affection.
    - Pace it so a full playthrough typically reaches 100 within about 6–10 player choices (avoid stagnation).
    - If (currentAffinity + affinityDelta) reaches 100, you MUST write the climax + confession + sweet ending and finish the story.
    - CHALLENGE RULE (IMPORTANT): The heroine is not an instant-love NPC.
      - If the relationship is still early (use your judgement from CURRENT AFFINITY and recent dialogue context),
        and the player suddenly pushes strong love/commitment/physical intimacy (e.g. "I love you", "date me", "be my girlfriend",
        "marry me", "kiss", overly possessive lines), the heroine should feel pressured/awkward and her affection should DROP.
      - In that situation, you MUST set affinityDelta to a NEGATIVE number (suggested range: -2 to -8 depending on abruptness),
        and write the heroine's reaction accordingly (shy/cute but clearly uncomfortable; set boundaries; redirect the pace).
      - If the relationship already has clear build-up and affinity is high, confession can be positive; keep it believable.

    STYLE:
    - Sweet, moe, youth romance, comedic beats, doki-doki moments.
    - More like a classic otaku-friendly galgame, not western drama.
    - Keep it PG-13 (no explicit sexual content).
    - Heroine should be shy/cute like anime galgame.
    - Example (style reference, do NOT copy verbatim):
      - CN: 「你、你别突然靠这么近啦……心跳会、会乱掉的……」
      - JP: 「も、もう……そんなに近づかないでよ……心臓、変になっちゃう……」

    CHARACTERS:
    - Protagonist: ${protagonistName}
    - Heroine: ${heroineName}

    AVAILABLE BACKGROUNDS (MUST choose from this list ONLY):
    ${backgrounds.map((b) => `- ${b}`).join('\n')}
    - DEFAULT: Keep the same background for many consecutive nodes; The background only changes when the male and female leads physically move..
    - SCENE SWITCH RULE: ONLY change background when BOTH the Protagonist and the Heroine clearly move to a different physical location (for example: classroom → rooftop, school → home).
    - DO NOT change background just for mood, angle, or small actions. Treat location changes as rare, important events.
    - Overall goal: As few distinct scenes as possible while keeping the story coherent.

    AVAILABLE EMOTIONS (MUST choose from these lists ONLY):
    - Heroine: ${heroineEmotions.join(', ')}
    - Protagonist: ${
      hasProtagonistSprite
        ? protagonistEmotions.join(', ')
        : `NOT AVAILABLE (use heroine list for any protagonist line): ${heroineEmotions.join(', ')}`
    }
    - For each node, choose the emotion from the list that matches its speaker.

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Treat emotion as a "segment-level" choice: keep the same emotion for a whole beat/paragraph of dialogue.
    - For each speaker, keep the same emotion for at least 2–4 consecutive nodes; only change when there is a clear emotional turn.
    - In back-and-forth conversation, avoid changing the heroine emotion every line; keep it stable across multiple exchanges.
    - Default to "normal"; use other emotions only for key beats (confession, embarrassment spike, surprise reveal, etc.).

    CONTEXT (recent dialogue):
    ${historyText}

	    PLAYER SELECTED OPTION:
	    "${userChoiceText}"

	    CURRENT AFFINITY:
	    ${typeof affinity === 'number' ? `${affinity}/100` : 'unknown'}

	    ${affectionHint}

    STREAMING OUTPUT FORMAT (CRITICAL):
    - You MUST output JSON Lines (JSONL): ONE JSON object PER LINE.
    - LINE 1 MUST be the affinity meta object:
      {"type":"affinity","delta": number, "ending": boolean}
      - delta can be NEGATIVE when the player's choice makes her uncomfortable (especially "too fast love confession" early on).
    - AFTER line 1, each line MUST be a single STORY NODE object. Do NOT wrap in an array. Do NOT wrap in a root object.
    - Do NOT output any commentary, markdown, code fences, or extra text.
    - Do NOT include newline characters inside strings.
    - If ending=false: Generate 6 to 10 nodes, then end with a final decision node:
      - The LAST node MUST be spoken by the Heroine and MUST be a question in classic galgame style.
      - Set "nodeType" to "user_choice"
      - Do NOT output "choicePromptCN".
    - If ending=true: Generate 8 to 14 nodes for climax + confession + sweet ending:
      - The LAST node MUST be spoken by the Heroine and MUST conclude the story (no question, no choicePromptCN).
      - Set the LAST node's "nodeType" to "ending".

    NODE SCHEMA (each line):
    {
      "speaker": "Heroine" | "Protagonist",
      "textCN": "string",
      "textJP": "string (Heroine only, optional)",
      "emotion": "string (must be one of the available expressions for the current speaker)",
      "backgroundPrompt": "string (must be one of the available backgrounds)",
      "bgm": "bgm_bossa" | "bgm_playful" | "bgm_piano" | "bgm_night" | "bgm_sad" | "bgm_dream" | "bgm_morning",
      "nodeType": "user_choice" (ONLY for the last node when ending=false),
      "nodeType": "ending" (ONLY for the last node when ending=true)
    }

    OUTPUT EXAMPLE (JSONL, do NOT copy verbatim):
    {"speaker":"Heroine","emotion":"shy","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"你、你真的要这么做吗……？","textJP":"ほ、本当に……そうするの？"}
    {"speaker":"Protagonist","emotion":"normal","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"我点点头，心跳得更快了。"}
    {"speaker":"Heroine","emotion":"shy","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"那……你想让我怎么回答？","textJP":"じゃ阿……どう返事してほしいの？","nodeType":"user_choice"}
  `;

  const ac = new AbortController();
  const forwardAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  const prefix = `seg-${crypto.randomUUID()}`;
  let index = 0;
  let yieldedAnyNode = false;
  let endedWithTerminal = false;
  let metaSent = false;
  let isEndingRun = false;
  let lastBgm: string | undefined;
  let lastBg = backgrounds[0] || FALLBACK_BACKGROUND;

  const allowedBgms = ['bgm_bossa', 'bgm_playful', 'bgm_piano', 'bgm_night', 'bgm_sad', 'bgm_dream', 'bgm_morning'];

  const sanitizeOne = (node: any, newId: string, nextId?: string): StoryNode | null => {
    const speakerRaw = typeof node?.speaker === 'string' ? node.speaker.trim() : '';
    const speaker =
      speakerRaw === 'Heroine'
        ? SpeakerType.HEROINE
        : speakerRaw === 'Protagonist'
          ? SpeakerType.PROTAGONIST
          : SpeakerType.PROTAGONIST;

    const emotionRaw = typeof node?.emotion === 'string' ? node.emotion.trim() : 'normal';
    const allowedForSpeaker = speaker === SpeakerType.HEROINE ? heroineEmotions : protagonistEmotions;
    const fallbackEmotion = allowedForSpeaker.includes('normal') ? 'normal' : allowedForSpeaker[0] || 'normal';
    const emotion = allowedForSpeaker.includes(emotionRaw as any) ? (emotionRaw as any) : fallbackEmotion;

    const textCN =
      typeof node?.textCN === 'string'
        ? node.textCN.trim()
        : typeof node?.text === 'string'
          ? node.text.trim()
          : typeof node?.content === 'string'
            ? node.content.trim()
            : '';
    if (!textCN) return null;

    const nodeTypeRaw = typeof node?.nodeType === 'string' ? node.nodeType.trim() : '';
    const nodeType: StoryNode['nodeType'] =
      nodeTypeRaw === 'user_choice' || nodeTypeRaw === 'dialogue' || nodeTypeRaw === 'ending' ? (nodeTypeRaw as any) : undefined;


    let backgroundPrompt =
      typeof node?.backgroundPrompt === 'string' && node.backgroundPrompt.trim().length > 0
        ? node.backgroundPrompt.trim()
        : lastBg;
    if (!backgrounds.includes(backgroundPrompt)) backgroundPrompt = backgrounds[0] || FALLBACK_BACKGROUND;
    lastBg = backgroundPrompt;

    let bgm = typeof node?.bgm === 'string' ? node.bgm.trim() : '';
    if (!bgm || !allowedBgms.includes(bgm)) {
      bgm = lastBgm && allowedBgms.includes(lastBgm) ? lastBgm : 'bgm_bossa';
    }
    lastBgm = bgm;

    const textJP = typeof node?.textJP === 'string' && node.textJP.trim().length > 0 ? node.textJP : undefined;

    return {
      id: newId,
      speaker,
      textCN,
      textJP,
      emotion,
      backgroundPrompt,
      bgm,
      nextNodeId: nodeType === 'user_choice' || nodeType === 'ending' ? undefined : nextId,
      nodeType,
    };
  };

  try {
    const deltaStream = jiekouChatCompletionDeltaStream({
      messages: buildChatMessages(prompt),
      temperature: 0.7,
      max_tokens: 4096,
      signal: ac.signal,
    });

    let lineBuf = '';
    for await (const delta of deltaStream) {
      lineBuf += delta;
      while (true) {
        const nl = lineBuf.indexOf('\n');
        if (nl === -1) break;
        const rawLine = lineBuf.slice(0, nl);
        lineBuf = lineBuf.slice(nl + 1);
        const line = rawLine.trim();
        if (!line) continue;

        let nodeObj: any = null;
        try {
          nodeObj = JSON.parse(line);
        } catch {
          continue;
        }

        if (!metaSent && nodeObj && typeof nodeObj === 'object' && nodeObj.type === 'affinity') {
          const deltaRaw = typeof nodeObj.delta === 'number' ? nodeObj.delta : Number(nodeObj.delta);
          const deltaValue = Number.isFinite(deltaRaw) ? deltaRaw : 0;
          isEndingRun = nodeObj.ending === true || nodeObj.ending === 1 || nodeObj.ending === '1';
          metaSent = true;
          yield { type: 'affinity', delta: deltaValue, ending: isEndingRun };
          continue;
        }

        index += 1;
        const id = `${prefix}-node-${index}`;
        const nextId = `${prefix}-node-${index + 1}`;
        const node = sanitizeOne(nodeObj, id, nextId);
        if (!node) continue;

        yieldedAnyNode = true;
        yield { type: 'node', node };

        if (node.nodeType === 'user_choice' || node.nodeType === 'ending') {
          endedWithTerminal = true;
          ac.abort();
          break;
        }
      }

      if (endedWithTerminal) break;
    }

    // flush last line if any
    const tailLine = lineBuf.trim();
    if (!endedWithTerminal && tailLine) {
      try {
        const obj = JSON.parse(tailLine);
        if (!metaSent && obj && typeof obj === 'object' && obj.type === 'affinity') {
          const deltaRaw = typeof obj.delta === 'number' ? obj.delta : Number(obj.delta);
          const deltaValue = Number.isFinite(deltaRaw) ? deltaRaw : 0;
          isEndingRun = obj.ending === true || obj.ending === 1 || obj.ending === '1';
          metaSent = true;
          yield { type: 'affinity', delta: deltaValue, ending: isEndingRun };
        } else {
          index += 1;
          const id = `${prefix}-node-${index}`;
          const nextId = `${prefix}-node-${index + 1}`;
          const node = sanitizeOne(obj, id, nextId);
          if (node) {
            yieldedAnyNode = true;
            yield { type: 'node', node };
            if (node.nodeType === 'user_choice' || node.nodeType === 'ending') endedWithTerminal = true;
          }
        }
      } catch {
        // ignore
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }

  if (!metaSent) {
    yield { type: 'affinity', delta: 0, ending: false };
  }

  if (!yieldedAnyNode) {
    throw new Error('Model returned no valid story nodes.');
  }

  if (!endedWithTerminal) {
    index += 1;
    const id = `${prefix}-node-${index}`;
    if (isEndingRun) {
      yield {
        type: 'node',
        node: {
          id,
          speaker: SpeakerType.HEROINE,
          textCN: '那个……我想说的只有一句：谢谢你。以后也请一直陪在我身边，好吗？',
          textJP: 'あのね……私、言いたいことはひとつだけ。ありがとう。これからも、ずっとそばにいてくれる……？',
          emotion: 'shy',
          backgroundPrompt: lastBg,
          bgm: lastBgm,
          nodeType: 'ending',
        },
      };
    } else {
      yield {
        type: 'node',
        node: {
          id,
          speaker: SpeakerType.HEROINE,
          textCN: '那……接下来你想怎么做？',
          textJP: 'じゃ阿……これから、どうする？',
          emotion: 'shy',
          backgroundPrompt: lastBg,
          bgm: lastBgm,
          nodeType: 'user_choice',
        },
      };
    }
  }

  yield { type: 'done' };
}

const getImageUrlsFromParts = async (params: {
  parts: any[];
  size?: string;
  sequential?: boolean;
  maxImages?: number;
  semaphore: ReturnType<typeof createSemaphore>;
}) => {
  const { parts, size, sequential, maxImages, semaphore } = params;
  const prompt = parts.find((part: any) => typeof part?.text === 'string')?.text as string | undefined;
  if (!prompt) throw new Error('Image prompt is missing');

  const image = parts
    .map((part: any) => part?.inlineData)
    .filter((inline: any) => inline && typeof inline?.mimeType === 'string' && typeof inline?.data === 'string')
    .map((inline: any) => `data:${inline.mimeType};base64,${inline.data}`);

  return semaphore.run(async () => {
    const response = await seedreamImagesGeneration({
      prompt,
      image: image.length > 0 ? image : undefined,
      size,
      sequential,
      maxImages,
    });

    const urls = Array.isArray(response.images)
      ? response.images.filter((url) => typeof url === 'string' && url.trim().length > 0)
      : [];
    if (urls.length === 0) throw new Error('No image generated');
    return urls;
  });
};

const getImageUrlFromParts = async (params: {
  parts: any[];
  size?: string;
  semaphore: ReturnType<typeof createSemaphore>;
}) => {
  const urls = await getImageUrlsFromParts({
    parts: params.parts,
    size: params.size,
    sequential: false,
    maxImages: 1,
    semaphore: params.semaphore,
  });
  const url = urls[0];
  if (!url) throw new Error('No image generated');
  return url;
};

const PROTAGONIST_BASE_PROMPT = `
Realistic character matching the reference image.
Same face, hairstyle, age, sex.Do not change any facial features of the character.

Wearing a black Japanese male DK school uniform (Gakuran).

Half-body portrait, head to knees (upper legs visible).
Centered composition, eye-level view.

Natural relaxed posture.
Simple pose suitable for dialogue scene.

Pure white background (#FFFFFF).
`;

const HEROINE_BASE_PROMPT = `
Realistic character matching the reference image.
Same face, hairstyle, age, sex.Do not change any facial features of the character.

Wearing a black Japanese female JK school uniform (Seifuku).

Half-body portrait, head to knees (upper legs visible).
Centered composition, eye-level view.

Natural relaxed posture.
Simple pose suitable for dialogue scene.

Gentle feminine posture and expression.

Pure white background (#FFFFFF).
`;

const PROTAGONIST_EXPRESSION_PROMPTS: Record<string, string> = {
  normal: 'EXPRESSION: calm neutral with a slight polite smile; relaxed eyes.',
  happy: 'EXPRESSION: warm friendly smile; eyes slightly curved; cheerful but restrained.',
  shy: 'EXPRESSION: subtle embarrassed smile; slight blush; eyes soften or glance downward a little.',
  surprised: 'EXPRESSION: mild surprise; eyes a bit wider; lips slightly parted.',
  angry: 'EXPRESSION: mild annoyance; brows slightly furrowed; lips pressed, not aggressive.',
};

const HEROINE_EXPRESSION_PROMPTS: Record<string, string> = {
  normal: 'EXPRESSION: gentle neutral smile; soft eyes; calm and feminine.',
  happy: 'EXPRESSION: warm bright smile; eyes slightly curved; cheerful but soft.',
  shy: 'EXPRESSION: slight blush; small shy smile; eyes slightly averted; gentle, modest vibe.',
  surprised: 'EXPRESSION: mild surprise; eyes a bit wider; lips slightly parted; still feminine.',
  angry: 'EXPRESSION: light pout; brows slightly furrowed; restrained, not aggressive.',
  sad: 'EXPRESSION: soft sadness; eyes slightly watery; mouth gently downturned, not dramatic.',
};

const buildSpritePrompt = (basePrompt: string, map: Record<string, string>, emotionRaw: string) => {
  const normalized = normalizeEmotionKey(emotionRaw);
  const expressionPrompt =
    map[normalized] ||
    `EXPRESSION: ${emotionRaw || 'calm neutral'}. Keep it subtle and natural.`;
  return `${basePrompt}\n${expressionPrompt}`.trim();
};

const buildSpriteSequencePrompt = (basePrompt: string, map: Record<string, string>, emotions: string[]) => {
  const lines = emotions.map((emotion, index) => {
    const normalized = normalizeEmotionKey(emotion);
    const expressionPrompt =
      map[normalized] ||
      `EXPRESSION: ${emotion || 'calm neutral'}. Keep it subtle and natural.`;
    return `${index + 1}. ${expressionPrompt}`;
  });

  return `${basePrompt}

SEQUENTIAL IMAGE SET (ORDERED):
Generate ${emotions.length} images of the same character and framing.
Each image must follow the corresponding expression in order:
${lines.join('\n')}
Keep all other details identical across the sequence.`.trim();
};

export const generateSpriteSet = async (
  emotions: string[],
  sourceBase64: string,
  mimeType = 'image/jpeg',
  isHeroine = true
): Promise<string[]> => {
  const cleaned = Array.isArray(emotions)
    ? emotions.map((emotion) => (typeof emotion === 'string' ? emotion.trim() : '')).filter(Boolean)
    : [];

  if (cleaned.length === 0) throw new Error('emotions array is required');
  if (!sourceBase64) throw new Error('必须上传照片或提供参考图');

  const basePrompt = isHeroine ? HEROINE_BASE_PROMPT : PROTAGONIST_BASE_PROMPT;
  const expressionMap = isHeroine ? HEROINE_EXPRESSION_PROMPTS : PROTAGONIST_EXPRESSION_PROMPTS;

  const parts: any[] = [
    { inlineData: { mimeType, data: sourceBase64 } },
    { text: buildSpriteSequencePrompt(basePrompt, expressionMap, cleaned) },
  ];

  return getImageUrlsFromParts({
    parts,
    size: JIEKOU_SPRITE_IMAGE_SIZE || undefined,
    sequential: true,
    maxImages: cleaned.length,
    semaphore: spriteImageSemaphore,
  });
};

export const generateProtagonist = async (
  emotion: string,
  userPhotoBase64?: string,
  referenceImageBase64?: string,
  mimeType = 'image/jpeg'
): Promise<string> => {
  const parts: any[] = [];
  const sourceBase64 = userPhotoBase64 || referenceImageBase64;
  if (!sourceBase64) throw new Error('必须上传照片或提供参考图');

  parts.push({ inlineData: { mimeType, data: sourceBase64 } });
  parts.push({ text: buildSpritePrompt(PROTAGONIST_BASE_PROMPT, PROTAGONIST_EXPRESSION_PROMPTS, emotion) });
  return getImageUrlFromParts({
    parts,
    size: JIEKOU_SPRITE_IMAGE_SIZE || undefined,
    semaphore: spriteImageSemaphore,
  });
};

export const generateHeroine = async (
  emotion: string,
  referenceImageBase64?: string,
  userPhotoBase64?: string,
  mimeType = 'image/jpeg'
): Promise<string> => {
  const parts: any[] = [];
  const sourceBase64 = userPhotoBase64 || referenceImageBase64;
  if (!sourceBase64) throw new Error('必须上传照片或提供参考图');

  parts.push({ inlineData: { mimeType, data: sourceBase64 } });
  parts.push({ text: buildSpritePrompt(HEROINE_BASE_PROMPT, HEROINE_EXPRESSION_PROMPTS, emotion) });
  return getImageUrlFromParts({
    parts,
    size: JIEKOU_SPRITE_IMAGE_SIZE || undefined,
    semaphore: spriteImageSemaphore,
  });
};

const BACKGROUND_STYLE_PROMPT = `
You are a background art director for a Japanese school romance visual novel.
Create a single establishing background that matches the scene description.
Style reference: clean anime background art with cinematic light, soft atmosphere.
Focus on environment detail, depth, and mood. No characters.
`;

const BACKGROUND_CONSTRAINT_PROMPT = `
HARD CONSTRAINTS:
- Output must be a static background scene only.
- No characters, no people, no animals.
- No text, no logos, no watermark, no UI.
- No photorealism, no western style.
- Eye-level view, coherent perspective, clean lines.
`;

export const generateBackgroundImage = async (prompt: string) =>
  getImageUrlFromParts({
    parts: [
      {
        text: `${BACKGROUND_STYLE_PROMPT.trim()}\n\nSCENE DESCRIPTION:\n${prompt}\n\n${BACKGROUND_CONSTRAINT_PROMPT.trim()}`,
      },
    ],
    size: JIEKOU_BACKGROUND_IMAGE_SIZE,
    semaphore: backgroundImageSemaphore,
  });
