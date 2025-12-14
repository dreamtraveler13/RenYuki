import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { GameScript, SpeakerType, StoryNode } from '@/types';

const FALLBACK_BACKGROUND = 'General anime scene';

const AUDIO_LIBRARY: Record<string, string> = {
  bgm_bossa: './public/music/song1.mp3',
  bgm_playful: './public/music/song2.mp3',
  bgm_piano: './public/music/song3.mp3',
  bgm_night: './public/music/song4.mp3',
  bgm_sad: './public/music/song5.mp3',
  bgm_dream: './public/music/song6.mp3',
  bgm_morning: './public/music/song7.mp3',
};

const LINGYAAI_BASE_URL = process.env.LINGYAAI_BASE_URL || 'https://api.lingyaai.cn';
const LINGYAAI_CHAT_MODEL = process.env.LINGYAAI_CHAT_MODEL || 'gemini-2.5-flash';
const LINGYAAI_IMAGE_MODEL = process.env.LINGYAAI_IMAGE_MODEL || 'doubao-seedream-4-5-251128';
const LINGYAAI_IMAGE_SIZE = process.env.LINGYAAI_IMAGE_SIZE || '2K';
const LINGYAAI_DEVELOPER_MESSAGE = process.env.LINGYAAI_DEVELOPER_MESSAGE || '你是一个有帮助的助手。';
const LINGYAAI_FETCH_TIMEOUT_MS = Number(process.env.LINGYAAI_FETCH_TIMEOUT_MS || 240_000);
const LINGYAAI_IMAGE_TIMEOUT_MS = Number(process.env.LINGYAAI_IMAGE_TIMEOUT_MS || 240_000);
const LINGYAAI_IMAGE_DOWNLOAD_TIMEOUT_MS = Number(process.env.LINGYAAI_IMAGE_DOWNLOAD_TIMEOUT_MS || 90_000);
const LINGYAAI_IMAGE_CONCURRENCY = Math.max(1, Number(process.env.LINGYAAI_IMAGE_CONCURRENCY || 16));

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

const imageSemaphore = createSemaphore(LINGYAAI_IMAGE_CONCURRENCY);

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

const ensureLingyaKey = () => {
  const key = process.env.LINGYAAI_API_KEY || process.env.API_KEY;
  if (!key) throw new Error('LINGYAAI_API_KEY is missing. Set it in your server environment.');
  return key;
};

const getLingyaErrorMessage = (data: any) => {
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

const lingyaPostJson = async <T>(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<T> => {
  const apiKey = ensureLingyaKey();
  const ac = new AbortController();
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? (opts!.timeoutMs as number) : LINGYAAI_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => ac.abort(), timeoutMs).unref?.();
  let resp: Response;
  try {
    resp = await fetch(`${LINGYAAI_BASE_URL}${path}`, {
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
    throw new Error(e?.message || 'fetch failed');
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

  if (!resp.ok) {
    const message = getLingyaErrorMessage(data) || (rawText.trim().length > 0 ? rawText.trim() : null) || `Request failed: ${resp.status}`;
    throw new Error(message);
  }

  if (!data) {
    const ct = resp.headers.get('content-type') || 'unknown';
    throw new Error(`Upstream returned empty/invalid JSON (status=${resp.status}, content-type=${ct})`);
  }

  // Some upstreams return 200 with an { error: ... } envelope.
  if (data && typeof data === 'object' && (data as any).error) {
    const message = getLingyaErrorMessage(data) || 'Upstream error';
    throw new Error(message);
  }

  return data as T;
};

type LingyaChatMessage = {
  role: 'developer' | 'user' | 'assistant' | 'model';
  content: string;
};

type LingyaChatCompletionResponse = {
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

const getChatChoice = (response: LingyaChatCompletionResponse) => response.choices?.[0];

const getChatContent = (response: LingyaChatCompletionResponse) => {
  const choice = getChatChoice(response);
  return choice?.message?.content || choice?.text || '';
};

const isGeminiModel = (model = LINGYAAI_CHAT_MODEL) => /\bgemini\b/i.test(model);

const buildChatMessages = (userContent: string): LingyaChatMessage[] => {
  const dev = typeof LINGYAAI_DEVELOPER_MESSAGE === 'string' ? LINGYAAI_DEVELOPER_MESSAGE.trim() : '';
  if (isGeminiModel()) {
    const merged = [dev, userContent].filter((s) => typeof s === 'string' && s.trim().length > 0).join('\n\n');
    return [{ role: 'user', content: merged }];
  }
  return [
    { role: 'developer', content: dev || 'You are a helpful assistant.' },
    { role: 'user', content: userContent },
  ];
};

const formatChatBlockedDetails = (response: LingyaChatCompletionResponse) => {
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

const maybeLogBlockedResponse = (response: LingyaChatCompletionResponse) => {
  const enabled =
    process.env.LINGYAAI_DEBUG === '1' || process.env.LINGYAAI_DEBUG === 'true' || process.env.LINGYAAI_DEBUG === 'yes';
  if (!enabled) return;
  try {
    console.error('LINGYAAI_DEBUG blocked response:', JSON.stringify(response).slice(0, 2000));
  } catch {
    console.error('LINGYAAI_DEBUG blocked response: [unserializable]');
  }
};

const lingyaChatCompletion = async (params: {
  messages: LingyaChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
}) =>
  lingyaPostJson<LingyaChatCompletionResponse>('/v1/chat/completions', {
    model: LINGYAAI_CHAT_MODEL,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.max_tokens,
    stream: false,
    ...(params.response_format ? { response_format: params.response_format } : {}),
  });

const lingyaChatCompletionStream = async (params: {
  messages: LingyaChatMessage[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}) => {
  const apiKey = ensureLingyaKey();
  const resp = await fetch(`${LINGYAAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LINGYAAI_CHAT_MODEL,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      stream: true,
    }),
    cache: 'no-store',
    signal: params.signal,
  });

  if (!resp.ok) {
    const rawText = await resp.text().catch(() => '');
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }
    const message = getLingyaErrorMessage(data) || (rawText.trim().length > 0 ? rawText.trim() : null) || `Request failed: ${resp.status}`;
    throw new Error(message);
  }

  if (!resp.body) {
    const ct = resp.headers.get('content-type') || 'unknown';
    throw new Error(`Upstream stream missing body (content-type=${ct})`);
  }

  return resp;
};

type LingyaChatCompletionChunk = {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    message?: { role?: string; content?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
};

const getChunkDeltaContent = (chunk: LingyaChatCompletionChunk) =>
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

async function* lingyaChatCompletionDeltaStream(params: {
  messages: LingyaChatMessage[];
  temperature?: number;
  max_tokens?: number;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const resp = await lingyaChatCompletionStream(params);
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() || '';
    for (const rawLine of parts) {
      const obj = parseStreamLineToChunkJson(rawLine);
      if (!obj) continue;
      const delta = getChunkDeltaContent(obj as LingyaChatCompletionChunk);
      if (delta) yield delta;
    }
  }

  if (buffer.trim()) {
    const obj = parseStreamLineToChunkJson(buffer);
    if (obj) {
      const delta = getChunkDeltaContent(obj as LingyaChatCompletionChunk);
      if (delta) yield delta;
    }
  }
}

type LingyaImagesGenerationResponse = {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
};

const lingyaImagesGeneration = async (params: { prompt: string; image?: string[]; aspectRatio?: string }) =>
  withRetry(
    () =>
      lingyaPostJson<LingyaImagesGenerationResponse>(
        '/v1/images/generations',
        {
          model: LINGYAAI_IMAGE_MODEL,
          prompt: params.prompt,
          image: params.image,
          n: 1,
          sequential_image_generation: 'disabled',
          response_format: 'url',
          size: LINGYAAI_IMAGE_SIZE,
          stream: false,
          watermark: false,
        },
        { timeoutMs: LINGYAAI_IMAGE_TIMEOUT_MS }
      ),
    { tries: 3, baseDelayMs: 800, maxDelayMs: 6500, label: 'lingyaImagesGeneration' }
  );

const fetchImageUrlAsBase64 = async (url: string) => {
  return withRetry(
    async () => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), LINGYAAI_IMAGE_DOWNLOAD_TIMEOUT_MS).unref?.();
      try {
        const resp = await fetch(url, { cache: 'no-store', signal: ac.signal });
        if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
        const buffer = Buffer.from(await resp.arrayBuffer());
        return buffer.toString('base64');
      } catch (e: any) {
        throw new Error(e?.message || 'fetch failed');
      } finally {
        clearTimeout(timer as any);
      }
    },
    { tries: 3, baseDelayMs: 500, maxDelayMs: 4000, label: 'fetchImageUrlAsBase64' }
  );
};

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
  opts?: { allowedBackgroundPrompts?: string[] }
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
  const allowedEmotions: Array<StoryNode['emotion']> = ['normal', 'happy', 'surprised', 'angry', 'shy', 'sad'];
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
      const emotion = allowedEmotions.includes(emotionRaw) ? emotionRaw : 'normal';

      const nodeTypeRaw = typeof node.nodeType === 'string' ? node.nodeType.trim() : '';
      const nodeType: StoryNode['nodeType'] =
        nodeTypeRaw === 'user_choice' || nodeTypeRaw === 'dialogue' || nodeTypeRaw === 'ending'
          ? (nodeTypeRaw as StoryNode['nodeType'])
          : undefined;
      const choicePromptCN =
        typeof node.choicePromptCN === 'string' && node.choicePromptCN.trim().length > 0 ? node.choicePromptCN.trim() : undefined;

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
        choicePromptCN,
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
      textJP: typeof last.textJP === 'string' && last.textJP.trim().length > 0 ? last.textJP : 'じゃあ……これから、どうする？',
      nextNodeId: undefined,
      choicePromptCN:
        typeof last.choicePromptCN === 'string' && last.choicePromptCN.trim().length > 0
          ? last.choicePromptCN
          : '请点击“新建”写出你的回答/行动，马上开始续写。',
    };

    const changed =
      patched.speaker !== last.speaker ||
      patched.textCN !== last.textCN ||
      patched.textJP !== last.textJP ||
      patched.nextNodeId !== last.nextNodeId ||
      patched.choicePromptCN !== last.choicePromptCN;

    if (!changed) return script;
    return { ...script, nodes: { ...script.nodes, [patched.id]: patched } };
  }

  const nodeId = `choice-${crypto.randomUUID()}`;
  const tail: StoryNode = {
    id: nodeId,
    speaker: SpeakerType.HEROINE,
    textCN: '那……接下来你想怎么做？',
    textJP: 'じゃあ……これから、どうする？',
    emotion: 'normal',
    backgroundPrompt: last?.backgroundPrompt,
    bgm: last?.bgm,
    nextNodeId: undefined,
    nodeType: 'user_choice',
    choicePromptCN: '请点击“新建”写出你的回答/行动，马上开始续写。',
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

export const generateScriptRaw = async (
  protagonistName: string,
  heroineName?: string,
  plotDescription?: string
): Promise<string> => {
  const targetHeroine = heroineName ? heroineName.trim() : 'Yuki';
  const customPlot = plotDescription ? `Specific Situation: "${plotDescription}"` : 'A fateful encounter at school.';
  const prompt = `
    You are the LEAD SCENARIO WRITER for a Japanese school romance visual novel (Galgame), like Senren * Banka (千恋＊万花).
    MISSION: Create a sweet, immersive, otaku-friendly school romance scene (classic galgame vibes).
    MODE: Episodic. Generate the FIRST EPISODE only (we will continue later via player input).
    GENRE: School Romance / Slice of Life / Youth / Moe-ge.
    TARGET AUDIENCE: Otaku who love sweet, doki-doki, and comedic moments.
    THEME: Youth campus love story. Keep it wholesome and PG-13.

    CHARACTERS:
    1. ${protagonistName} (Protagonist): A high school student.
    2. ${targetHeroine} (Heroine): The main love interest. Deeply cares about ${protagonistName}.

    PLOT: ${customPlot}

    DIALOGUE STYLE (VERY IMPORTANT):
    - The Heroine must sound like a shy anime girl in a real galgame: tsun/shy beats, flustered, sweet, cute.
    - Mix cute teasing + embarrassment + small romantic tension; avoid western drama.
    - Example (style reference, do NOT copy verbatim):
      - CN: 「诶？！才、才没有在等你呢……只是刚好路过！」/「你、你别盯着我看啦……」
      - JP: 「えっ？！べ、別に待ってたわけじゃないんだから……ただ通りかかっただけ！」/「も、もう……見ないでよ……」

    VISUAL & AUDIO DIRECTION:
    - BACKGROUNDS (SCENE CONTROL, VERY IMPORTANT):
      - HARD LIMIT: Use AT MOST 3 unique backgrounds for the entire story and REUSE them heavily.
      - DEFAULT: Keep the same background for many consecutive nodes; do NOT change backgrounds frequently.
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
        - Add "choicePromptCN" to ask the player to click “新建”, type their option, and start continuation (galgame UI)
        - Do NOT provide predefined choices.

    SCHEMA CONSTRAINTS:
    - speaker: "Heroine" or "Protagonist".
    - emotion: "normal", "happy", "surprised", "angry", "shy", "sad".

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Keep the same emotion for several consecutive nodes unless the mood clearly changes.
    - Default to "normal"; use other emotions only for key beats.
  `;

  const response = await lingyaChatCompletion({
    messages: buildChatMessages(prompt),
    temperature: 0.6,
    max_tokens: 8192,
  });

  const rawText = getChatContent(response);
  if (!rawText || rawText.trim().length === 0) {
    maybeLogBlockedResponse(response);
    throw new Error(`AI Generation Blocked${formatChatBlockedDetails(response)}`);
  }
  return rawText;
};

export const generateScript = async (protagonistName: string, heroineName?: string, plotDescription?: string): Promise<GameScript> => {
  const targetHeroine = heroineName ? heroineName.trim() : 'Yuki';
  const customPlot = plotDescription ? `Specific Situation: "${plotDescription}"` : 'A fateful encounter at school.';
  const prompt = `
    You are the LEAD SCENARIO WRITER for a Japanese school romance visual novel (Galgame), like Senren * Banka (千恋＊万花).
    MISSION: Create a DEEP, immersive, and emotionally intense scene.
    MODE: Episodic. Generate the FIRST EPISODE only (we will continue later via player input).
    GENRE: School Romance / Slice of Life / Youth / Moe-ge.
    TARGET AUDIENCE: Otaku who love sweet, doki-doki, and comedic moments.
    THEME: Youth campus love story. Keep it wholesome and PG-13.

    CHARACTERS:
    1. ${protagonistName} (Protagonist): A high school student.
    2. ${targetHeroine} (Heroine): The main love interest. Deeply cares about ${protagonistName}.

    PLOT: ${customPlot}

    DIALOGUE STYLE (VERY IMPORTANT):
    - The Heroine must sound like a shy anime girl in a real galgame: flustered, sweet, cute.
    - Use classic galgame beats: small misunderstandings, heart-thumping moments, cute teasing, gentle intimacy.
    - Example (style reference, do NOT copy verbatim):
      - CN: 「你、你突然这么认真……会让我误会的啦……」/「那、那你要不要……放学一起走？」 
      - JP: 「そ、そんなに真剣に見ないでよ……勘違いしちゃう……」/「ね、ねえ……放課後、一緒に帰らない？」

    VISUAL & AUDIO DIRECTION:
    - BACKGROUNDS (SCENE CONTROL, VERY IMPORTANT):
      - HARD LIMIT: Use AT MOST 3 unique backgrounds for the entire story and REUSE them heavily.
      - DEFAULT: Keep the same background for many consecutive nodes; do NOT change backgrounds frequently.
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
        - Add "choicePromptCN" to ask the player to click “新建”, type their option, and start continuation (galgame UI)
        - Do NOT provide predefined choices.

    SCHEMA CONSTRAINTS:
    - speaker: "Heroine" or "Protagonist".
    - emotion: "normal", "happy", "surprised", "angry", "shy", "sad".

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Keep the same emotion for several consecutive nodes unless the mood clearly changes.
    - Default to "normal"; use other emotions only for key beats.
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
    lingyaChatCompletion({
      messages: buildChatMessages(prompt),
      temperature: params.temperature,
      max_tokens: 8192,
      response_format: params.response_format,
    });

  const generateOnce = async (temperature: number) => {
    const first = await callScriptChat({ temperature });
    let rawText = getChatContent(first);
    if (!rawText || rawText.trim().length === 0) {
      maybeLogBlockedResponse(first);
      throw new Error(`AI Generation Blocked${formatChatBlockedDetails(first)}`);
    }

    let rawData = extractJSON(rawText);

    const { nodes, startNodeId } = normalizeNodes(rawData);

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

export const continueStory = async (params: {
  protagonistName: string;
  heroineName: string;
  userChoiceText: string;
  affinity?: number;
  allowedBackgroundPrompts: string[];
  recentDialogue: Array<{ speaker: string; textCN: string }>;
}): Promise<{ nodes: Record<string, StoryNode>; startNodeId: string; affinityDelta: number; ending: boolean }> => {
  const { protagonistName, heroineName, userChoiceText, affinity, allowedBackgroundPrompts, recentDialogue } = params;

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

    AVAILABLE EMOTIONS (MUST choose from this list ONLY):
    - normal, happy, surprised, angry, shy, sad

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Keep the same emotion for several consecutive nodes unless the mood clearly changes.
    - Default to "normal"; use other emotions only for key beats.

    CONTEXT (recent dialogue):
    ${historyText}

	    PLAYER SELECTED OPTION:
	    "${userChoiceText}"

	    CURRENT AFFINITY:
	    ${typeof affinity === 'number' ? `${affinity}/100` : 'unknown'}

	    ${affectionHint}
	
	    OUTPUT REQUIREMENTS:
	    - OUTPUT FORMAT: RAW JSON ONLY, one single JSON object, no markdown.
	      - Use the TOP-LEVEL KEY "nodes".
	      - You MUST include top-level keys:
	        - "affinityDelta": number (can be negative; typical range -10..+20)
	        - "ending": boolean
	      - If ending=false:
	        - Generate 6 to 10 new STORY NODES, then end with a user input decision point node:
	          - Set "nodeType" to "user_choice"
	          - The LAST node MUST be spoken by the Heroine and MUST be a question in classic galgame style
	          - Add "choicePromptCN" to ask the player to click “新建”, type their option, and start continuation (galgame UI)
	          - Do NOT provide predefined choices.
	      - If ending=true:
	        - Generate 8 to 14 nodes for the climax + confession + sweet ending.
	        - The LAST node MUST be spoken by the Heroine and MUST conclude the story (no question, no choicePromptCN).
	        - Set the LAST node's "nodeType" to "ending".
	    - Every node MUST include fields: id, speaker, textCN, emotion, backgroundPrompt.
	    - Heroine lines should include textJP (Japanese) when appropriate.
	  `;

  const response = await lingyaChatCompletion({
    messages: buildChatMessages(prompt),
    temperature: 0.7,
    max_tokens: 4096,
  });

  const rawText = getChatContent(response);
  if (!rawText || rawText.trim().length === 0) {
    maybeLogBlockedResponse(response);
    throw new Error(`AI Generation Blocked${formatChatBlockedDetails(response)}`);
  }

  const rawData = extractJSON(rawText);
  const affinityDelta =
    typeof (rawData as any)?.affinityDelta === 'number'
      ? (rawData as any).affinityDelta
      : Number.isFinite(Number((rawData as any)?.affinityDelta))
        ? Number((rawData as any).affinityDelta)
        : 0;
  const ending = (rawData as any)?.ending === true || (rawData as any)?.ending === 1 || (rawData as any)?.ending === '1';
  const parsed = normalizeNodes(rawData, { allowedBackgroundPrompts: backgrounds });
  const prefixed = prefixNodeIds(parsed.nodes);

  const startNodeId = prefixed[parsed.startNodeId]?.id || Object.keys(prefixed)[0];
  if (ending) {
    return { nodes: prefixed, startNodeId, affinityDelta, ending: true };
  }

  const script = ensureUserChoiceTail({ title: 'Segment', heroineName, startNodeId, nodes: prefixed });
  return { nodes: script.nodes, startNodeId: script.startNodeId, affinityDelta, ending: false };
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
  recentDialogue: Array<{ speaker: string; textCN: string }>;
  signal?: AbortSignal;
}): AsyncGenerator<ContinueStoryStreamEvent> {
  const { protagonistName, heroineName, userChoiceText, affinity, allowedBackgroundPrompts, recentDialogue, signal } = params;

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
    - Write like a real Japanese school romance galgame with a clear arc and rising romantic tension.
    - Decide an "affinityDelta" for this option and output it FIRST as the meta line.
    - Pace it so a full playthrough typically reaches 100 within about 6–10 player choices (avoid stagnation).
    - If (currentAffinity + affinityDelta) reaches 100, you MUST write the climax + confession + sweet ending,
      and end the story with a final "ending" node.

    STYLE:
    - Youth campus romance, sweet, moe, comedic beats, doki-doki moments.
    - Heroine should be shy/cute like anime galgame (flustered, sweet, tsun/shy beats).
    - Keep it wholesome and PG-13.
    - Example (style reference, do NOT copy verbatim):
      - CN: 「你、你突然这么认真……会让我误会的啦……」/「那、那你要不要……放学一起走？」 
      - JP: 「そ、そんなに真剣に見ないでよ……勘違いしちゃう……」/「ね、ねえ……放課後、一緒に帰らない？」

    CHARACTERS:
    - Protagonist: ${protagonistName}
    - Heroine: ${heroineName}

    AVAILABLE BACKGROUNDS (MUST choose from this list ONLY):
    ${backgrounds.map((b) => `- ${b}`).join('\n')}

    AVAILABLE EMOTIONS (MUST choose from this list ONLY):
    - normal, happy, surprised, angry, shy, sad

    EMOTION CONSISTENCY (IMPORTANT):
    - Emotion selects the sprite. Do NOT switch emotions frequently.
    - Keep the same emotion for several consecutive nodes unless the mood clearly changes.
    - Default to "normal"; use other emotions only for key beats.

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
    - AFTER line 1, each line MUST be a single STORY NODE object. Do NOT wrap in an array. Do NOT wrap in a root object.
    - Do NOT output any commentary, markdown, code fences, or extra text.
    - Do NOT include newline characters inside strings.
    - If ending=false: Generate 6 to 10 nodes, then end with a final decision node:
      - The LAST node MUST be spoken by the Heroine and MUST be a question in classic galgame style.
      - Set "nodeType" to "user_choice"
      - Include "choicePromptCN" to ask the player to click “新建”, type their option, and start continuation (galgame style).
    - If ending=true: Generate 8 to 14 nodes for climax + confession + sweet ending:
      - The LAST node MUST be spoken by the Heroine and MUST conclude the story (no question, no choicePromptCN).
      - Set the LAST node's "nodeType" to "ending".

    NODE SCHEMA (each line):
    {
      "speaker": "Heroine" | "Protagonist",
      "textCN": "string",
      "textJP": "string (Heroine only, optional)",
      "emotion": "normal" | "happy" | "surprised" | "angry" | "shy" | "sad",
      "backgroundPrompt": "string (must be one of the available backgrounds)",
      "bgm": "bgm_bossa" | "bgm_playful" | "bgm_piano" | "bgm_night" | "bgm_sad" | "bgm_dream" | "bgm_morning",
      "nodeType": "user_choice" (ONLY for the last node when ending=false),
      "choicePromptCN": "string (ONLY for the last node when ending=false)",
      "nodeType": "ending" (ONLY for the last node when ending=true)
    }

    OUTPUT EXAMPLE (JSONL, do NOT copy verbatim):
    {"speaker":"Heroine","emotion":"shy","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"你、你真的要这么做吗……？","textJP":"ほ、本当に……そうするの？"}
    {"speaker":"Protagonist","emotion":"normal","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"我点点头，心跳得更快了。"}
    {"speaker":"Heroine","emotion":"shy","backgroundPrompt":"classroom","bgm":"bgm_piano","textCN":"那……你想让我怎么回答？","textJP":"じゃあ……どう返事してほしいの？","nodeType":"user_choice","choicePromptCN":"请点击“新建”写出你的回答/行动，马上开始续写。"}
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

  const allowedEmotions: Array<StoryNode['emotion']> = ['normal', 'happy', 'surprised', 'angry', 'shy', 'sad'];
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
    const emotion = allowedEmotions.includes(emotionRaw as any) ? (emotionRaw as any) : 'normal';

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

    const choicePromptCN =
      typeof node?.choicePromptCN === 'string' && node.choicePromptCN.trim().length > 0 ? node.choicePromptCN.trim() : undefined;

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
      choicePromptCN,
    };
  };

  try {
    const deltaStream = lingyaChatCompletionDeltaStream({
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
          textJP: 'じゃあ……これから、どうする？',
          emotion: 'shy',
          backgroundPrompt: lastBg,
          bgm: lastBgm,
          nodeType: 'user_choice',
          choicePromptCN: '请点击“新建”写出你的回答/行动，马上开始续写。',
        },
      };
    }
  }

  yield { type: 'done' };
}

const getImageUrlFromParts = async (parts: any[], aspectRatio = '1:1') => {
  const prompt = parts.find((part: any) => typeof part?.text === 'string')?.text as string | undefined;
  if (!prompt) throw new Error('Image prompt is missing');

  const image = parts
    .map((part: any) => part?.inlineData)
    .filter((inline: any) => inline && typeof inline?.mimeType === 'string' && typeof inline?.data === 'string')
    .map((inline: any) => `data:${inline.mimeType};base64,${inline.data}`);

  return imageSemaphore.run(async () => {
    const response = await lingyaImagesGeneration({
      prompt,
      image: image.length > 0 ? image : undefined,
      aspectRatio,
    });

    const url = response.data?.[0]?.url;
    if (!url) throw new Error('No image generated');
    return url;
  });
};

export const generateProtagonist = async (
  emotion: string,
  userPhotoBase64?: string,
  referenceImageBase64?: string,
  mimeType = 'image/jpeg'
): Promise<string> => {
  const parts: any[] = [];
  let prompt = '';

	  if (userPhotoBase64) {
	    parts.push({ inlineData: { mimeType, data: userPhotoBase64 } });
	    prompt = `
	      CRITICAL INSTRUCTION:
	      1. FACE/HEAD: Must be 100% PIXEL-PERFECT MATCH to the provided reference image.
	      2. BODY/POSE: Generate a NEW body pose matching: "${emotion}". Keep it subtle and natural (NO exaggerated action).
	      3. CLOTHING: Black Japanese Gakuran Uniform.
	      4. INTEGRATION: Seamlessly attach the reference face to the new body pose.
	      5. FRAMING: Half-body or full-body portrait, eye-level camera, front view.
	      STYLE: Photorealistic. BACKGROUND: Pure Solid White (Hex #FFFFFF).
	    `;
	  } else if (referenceImageBase64) {
	    parts.push({ inlineData: { mimeType: guessMimeTypeFromBase64(referenceImageBase64, mimeType), data: referenceImageBase64 } });
	    prompt = `
	      Reference: This anime character.
	      Task: Redraw this character with NEW pose/expression: ${emotion} (subtle, no exaggerated action).
	      Constraint: Keep facial features, hair, and clothing (Black Gakuran) identical.
	      Framing: Half-body or full-body portrait, eye-level camera, front view.
	      Background: Solid white.
	    `;
	  } else {
	    prompt = `
	      Generate a handsome anime boy character sprite.
	      Style: Kyoto Animation (Clannad).
	      Clothing: Japanese High School Uniform (Black Gakuran).
	      Appearance: Short black hair, friendly face.
	      Expression: ${emotion} (subtle, no exaggerated action).
	      Framing: Half-body or full-body portrait, eye-level camera, front view.
	      Background: Solid white.
	    `;
	  }

  parts.push({ text: prompt });
  return getImageUrlFromParts(parts, '1:1');
};

export const generateHeroine = async (
  emotion: string,
  referenceImageBase64?: string,
  userPhotoBase64?: string,
  mimeType = 'image/jpeg'
): Promise<string> => {
  const parts: any[] = [];
  let prompt = '';

	  if (userPhotoBase64) {
	    parts.push({ inlineData: { mimeType, data: userPhotoBase64 } });
	    prompt = `
	      CRITICAL INSTRUCTION:
	      1. FACE/HEAD: Must be 100% PIXEL-PERFECT MATCH to the provided reference image.
	      2. BODY/POSE: Generate a NEW body pose matching: "${emotion}". Make the expression CLEARER and the gesture SLIGHTLY more obvious than before (still natural; NO exaggerated action).
	      3. CLOTHING: Japanese Sailor School Uniform (Seifuku).
	      4. INTEGRATION: Seamlessly attach the reference face to the new body pose.
	      5. FRAMING: Half-body or full-body portrait, eye-level camera, front view.
	      6. VIBE: "少女化" / a sweet, youthful schoolgirl vibe (still the SAME face & hairstyle).
	      STYLE: Photorealistic. BACKGROUND: Pure Solid White (Hex #FFFFFF).
	      EXPRESSION/POSE HINTS (pick ONE that fits "${emotion}"):
	      - shy: blushing, avoiding eye contact slightly, fingers fidgeting, small nervous smile
	      - pampering/撒娇: puffed cheeks, tiny pout, hands lightly pulling sleeve
	      - sad: watery eyes, slightly downturned mouth, shoulders a bit slumped
	    `;
	  } else if (referenceImageBase64) {
	    parts.push({ inlineData: { mimeType: guessMimeTypeFromBase64(referenceImageBase64, mimeType), data: referenceImageBase64 } });
	    prompt = `
	      Reference: This anime character (a cute schoolgirl / 少女).
	      Task: Redraw this character with NEW pose/expression: ${emotion}.
	      Constraints (STRICT):
	      - Keep facial features and hairstyle IDENTICAL (do NOT change face shape, eyes, nose, mouth, bangs, hair length).
	      - Keep clothing (Sailor suit) identical.
	      - Expression must be MORE CLEAR and the gesture slightly more obvious (still natural; no exaggerated action).
	      Framing: Half-body or full-body portrait, eye-level camera, front view.
	      Background: Solid white.
	      VIBE: "少女化" / sweet youthful schoolgirl vibe.
	      EXPRESSION/POSE HINTS (pick ONE that fits ${emotion}):
	      - shy: blushing, eyes glancing away, hands close to chest
	      - pampering/撒娇: tiny pout, cheeks slightly puffed, shy smile after teasing
	      - sad: watery eyes, gentle trembling smile, looking down a bit
	    `;
	  } else {
	    prompt = `
	      Generate a cute anime schoolgirl character sprite (一个可爱的少女 / "少女化").
	      Style: Kyoto Animation (Clannad).
	      Appearance: Long light brown hair, big eyes, school uniform with ribbon.
	      Expression: ${emotion} (make it clearly readable; slightly more obvious than before, but not exaggerated).
	      Pose: small, cute, natural gesture that matches the emotion (e.g., shy fidgeting, light sleeve tug, tiny pout).
	      Framing: Half-body or full-body portrait, eye-level camera, front view.
	      Background: Solid white.
	    `;
	  }

  parts.push({ text: prompt });
  return getImageUrlFromParts(parts, '1:1');
};

export const generateBackgroundImage = async (prompt: string) =>
  getImageUrlFromParts(
    [
      {
        text: `Japanese anime background art only, youth campus romance vibe, Makoto Shinkai influence, eye-level view, clean lines, soft sunlight, ${prompt}, detailed environment, no characters, no text, no watermark, no photorealism, no western style.`,
      },
    ],
    '16:9'
  );

export const generateMemoryCoverImage = async (params: {
  heroineName: string;
  protagonistName: string;
  scenePrompt?: string;
  affinity?: number;
}) => {
  const { heroineName, protagonistName, scenePrompt, affinity } = params;
  const affectionHint =
    typeof affinity === 'number'
      ? `Their relationship score is ${affinity} out of 100, so they should look very close and sweet.`
      : '';

  const scene =
    scenePrompt && scenePrompt.trim().length > 0
      ? scenePrompt.trim()
      : 'a romantic Japanese high school setting, soft evening light, gentle atmosphere';

  const text = `
    High quality anime illustration, 16:9.
    Show ${protagonistName} (protagonist) and ${heroineName} (heroine) together in the same scene: ${scene}.
    They are doing a sweet couple activity (for example: walking side by side, holding hands, smiling at each other).
    Full body or half body composition is acceptable, but BOTH characters must be clearly visible in the frame.
    ${affectionHint}
    Style: Japanese anime, clean lines, saturated but soft colors, no photorealism, no western style.
    No text, no UI elements, no game screenshots, no additional characters.
  `;

  return getImageUrlFromParts([{ text }], '16:9');
};

export const loadMusicBase64 = async () => {
  const musicData: Record<string, string> = {};
  for (const [key, file] of Object.entries(AUDIO_LIBRARY)) {
    try {
      const buff = fs.readFileSync(path.join(process.cwd(), file));
      musicData[key] = buff.toString('base64');
    } catch (e) {
      console.warn(`Music missing: ${file}`);
    }
  }
  return musicData;
};
