const TARGET_SIZE_BYTES = 30 * 1024 * 1024; // ~30MB

const padToTargetSize = (baseObject) => {
  const json = JSON.stringify(baseObject);
  if (json.length >= TARGET_SIZE_BYTES) return json;
  const paddingLength = TARGET_SIZE_BYTES - json.length + 1024;
  // Padding with a predictable string keeps JSON valid while making sure the payload is big enough.
  return JSON.stringify({ ...baseObject, padding: 'x'.repeat(paddingLength) });
};

export const buildMockGalgame = (payload) => {
  const now = new Date().toISOString();
  const protagonist = payload?.protagonistName || 'Player';
  const heroine = payload?.heroineName || 'Yuki';
  const plot = payload?.plotDescription || 'A fateful encounter on the rooftop.';

  const dummyImage = 'iVBORw0KGgoAAAANSUhEUgAAAAUA'; // small base64 head, repeated later
  const dummyVoice = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; // wav header stub
  const nodes = Array.from({ length: 10 }).map((_, idx) => ({
    id: `node-${idx + 1}`,
    speaker: idx % 2 === 0 ? 'Heroine' : 'Protagonist',
    textCN: `剧情片段 ${idx + 1} - ${plot}`,
    textJP: `シーン ${idx + 1}`,
    emotion: 'happy',
    backgroundPrompt: 'City sunset street',
    bgm: 'bgm_playful',
    nextNodeId: idx < 9 ? `node-${idx + 2}` : null,
    choices: null,
    cgs: [`${dummyImage}${'A'.repeat(128)}`],
    voice: `${dummyVoice}${'B'.repeat(256)}`,
  }));

  const base = {
    meta: {
      generatedAt: now,
      protagonist,
      heroine,
      plot,
      source: 'edgeone-direct',
    },
    nodes,
    assets: {
      heroineSprite: `${dummyImage}${'C'.repeat(1024)}`,
      protagonistSprite: `${dummyImage}${'D'.repeat(1024)}`,
      bgm: 'bgm_playful',
    },
  };

  return padToTargetSize(base);
};

/**
 * In real deployments, replace the mock builder with an API call to your AI backend.
 */
export const generatePayload = async (env, payload) => {
  if (env.AI_BACKEND_URL) {
    const upstream = await fetch(env.AI_BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!upstream.ok) {
      throw new Error(`AI backend failed: ${upstream.status}`);
    }
    return upstream.text();
  }
  return buildMockGalgame(payload);
};
