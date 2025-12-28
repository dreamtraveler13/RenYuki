const DASH_SCOPE_ENDPOINT =
  'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

const formatToMime: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

const guessMime = (format?: string) => {
  if (!format) return 'audio/wav';
  const key = format.toLowerCase();
  return formatToMime[key] || 'audio/wav';
};

const dataToDataUrl = (base64: string, mimeType?: string) => {
  const trimmed = base64.trim();
  if (trimmed.startsWith('data:')) return trimmed;
  return `data:${mimeType || 'audio/wav'};base64,${trimmed}`;
};

const fetchAudioUrlToBase64 = async (url: string): Promise<{ base64: string; mimeType: string }> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TTS audio fetch failed: ${resp.status}`);
  const contentType = resp.headers.get('content-type') || 'audio/wav';
  const buf = Buffer.from(await resp.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType: contentType };
};

export const generateHeroineTts = async (params: {
  text: string;
  voice?: string;
  languageType?: string;
}): Promise<{ dataUrl: string; mimeType: string }> => {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is required');
  const text = params.text.trim();
  if (!text) throw new Error('TTS text is required');

  const payload = {
    model: 'qwen3-tts-flash-2025-11-27',
    input: {
      text,
      voice: params.voice || 'Cherry',
      language_type: params.languageType || 'Japanese',
    },
  };

  const resp = await fetch(DASH_SCOPE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const message = data?.message || data?.error?.message || `TTS request failed: ${resp.status}`;
    throw new Error(message);
  }

  const output = data?.output || {};
  const audio = output.audio;
  if (audio?.data && typeof audio.data === 'string') {
    const mimeType = guessMime(audio.format);
    return { dataUrl: dataToDataUrl(audio.data, mimeType), mimeType };
  }
  if (typeof audio === 'string') {
    const mimeType = guessMime(output.format);
    return { dataUrl: dataToDataUrl(audio, mimeType), mimeType };
  }
  if (audio?.url && typeof audio.url === 'string') {
    const fetched = await fetchAudioUrlToBase64(audio.url);
    return { dataUrl: dataToDataUrl(fetched.base64, fetched.mimeType), mimeType: fetched.mimeType };
  }
  if (output.audio_url && typeof output.audio_url === 'string') {
    const fetched = await fetchAudioUrlToBase64(output.audio_url);
    return { dataUrl: dataToDataUrl(fetched.base64, fetched.mimeType), mimeType: fetched.mimeType };
  }

  throw new Error('TTS response missing audio data');
};
