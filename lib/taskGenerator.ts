type MockPayload = {
  protagonistName?: string;
  heroineName?: string;
  plotDescription?: string;
};

const TARGET_SIZE_BYTES = 30 * 1024 * 1024; // ~30MB to mimic large payload

const padToTargetSize = (baseObject: Record<string, unknown>) => {
  const json = JSON.stringify(baseObject);
  if (json.length >= TARGET_SIZE_BYTES) return json;
  const paddingLength = TARGET_SIZE_BYTES - json.length + 1024;
  return JSON.stringify({ ...baseObject, padding: 'x'.repeat(paddingLength) });
};

export const buildMockGalgame = (payload: MockPayload = {}) => {
  const now = new Date().toISOString();
  const protagonist = payload.protagonistName || 'Player';
  const heroine = payload.heroineName || 'Yuki';
  const plot = payload.plotDescription || 'A fateful encounter on the rooftop.';

  const dummyImage = 'iVBORw0KGgoAAAANSUhEUgAAAAUA'; // small base64 head, repeated later
  const dummyVoice = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  const nodes = Array.from({ length: 10 }).map((_, idx) => ({
    id: `node-${idx + 1}`,
    speaker: idx % 2 === 0 ? 'Heroine' : 'Protagonist',
    textCN: `剧情片段 ${idx + 1} - ${plot}`,
    textJP: `シーン ${idx + 1}`,
    emotion: 'happy',
    backgroundPrompt: 'City sunset street',
    bgm: 'bgm_playful',
    nextNodeId: idx < 9 ? `node-${idx + 2}` : null,
    choices: null as null,
    cgs: [`${dummyImage}${'A'.repeat(128)}`],
    voice: `${dummyVoice}${'B'.repeat(256)}`,
  }));

  const base = {
    meta: {
      generatedAt: now,
      protagonist,
      heroine,
      plot,
      source: 'memory-mock',
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
