import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { GeneratedAssets, GameScript, SpeakerType, StoryNode, UserProfile } from '@/types';
import { createJob, updateJob } from '@/lib/gameGenerationCache';
import { enqueueGenerationJob } from '@/lib/generationQueue';
import {
  generateBackgroundImage,
  generateSpriteSet,
  generateScript,
  inferBackgroundScenes,
  withAiDebug,
} from '@/lib/aiServer';
import { refundUserCoins } from '@/lib/userStore';
import { generateHeroineTts } from '@/lib/ttsServer';
import { createGenerationJobRecord, updateGenerationJobRecord } from '@/lib/generationJobStore';
import { createSave } from '@/lib/saveStore';

export interface StartGameGenerationInput {
  protagonistName?: string;
  heroineName?: string;
  plotDescription: string;
  maxMode?: boolean | 0 | 1 | '0' | '1';
  standardVariant?: 1 | 2;
  protagonistPhotoBase64?: string;
  protagonistMimeType?: string;
  heroinePhotoBase64?: string;
  heroineMimeType?: string;
}

export interface GeneratedGamePayload {
  script: GameScript;
  assets: GeneratedAssets;
  userProfile: UserProfile;
  initialNodeId: string;
  initialAffinity: number;
}

const downloadToBase64 = async (url: string): Promise<string> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`图片下载失败: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
};

const sanitizeScenes = (scenes: Array<{ name: string; prompt: string }>) => {
  const cleaned = scenes
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      name: typeof s.name === 'string' ? s.name.trim() : '',
      prompt: typeof s.prompt === 'string' ? s.prompt.trim() : '',
    }))
    .filter((s) => s.name.length > 0)
    .slice(0, 3);

  const seen = new Set<string>();
  return cleaned.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
};

const DEFAULT_CAMPUS_KEY = '校园';
const STANDARD1_BACKGROUNDS_DIR = path.join(process.cwd(), 'public', 'backgrounds');

let cachedStandard1BackgroundFiles: string[] | null = null;
const cachedStandard1BackgroundBase64: Record<string, string> = {};

const listStandard1BackgroundFiles = async (): Promise<string[]> => {
  if (cachedStandard1BackgroundFiles) return cachedStandard1BackgroundFiles;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(STANDARD1_BACKGROUNDS_DIR);
  } catch {
    entries = [];
  }

  const files = entries
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp';
    })
    .map((name) => path.join(STANDARD1_BACKGROUNDS_DIR, name));

  cachedStandard1BackgroundFiles = files;
  return files;
};

const getRandomStandard1BackgroundBase64 = async (): Promise<string> => {
  const files = await listStandard1BackgroundFiles();
  if (!files.length) {
    throw new Error('普通生成1缺少默认背景：请在 public/backgrounds 放入至少一张图片');
  }
  const idx = Math.floor(Math.random() * files.length);
  const picked = files[idx];
  if (cachedStandard1BackgroundBase64[picked]) return cachedStandard1BackgroundBase64[picked];
  const buf = await fs.readFile(picked);
  const b64 = buf.toString('base64');
  cachedStandard1BackgroundBase64[picked] = b64;
  return b64;
};

const generateProtagonistSet = async (input: StartGameGenerationInput) => {
  const mimeType = input.protagonistMimeType || 'image/jpeg';

  if (input.protagonistPhotoBase64) {
    const emotionSet: Array<keyof GeneratedAssets['protagonist']> = ['normal', 'happy', 'shy'];
    const urls = await generateSpriteSet(emotionSet, input.protagonistPhotoBase64, mimeType, false);
    const images = await Promise.all(urls.map(downloadToBase64));
    const out: any = {};
    emotionSet.forEach((key, i) => {
      out[key] = images[i] || images[0] || '';
    });
    if (!out.normal) out.normal = images[0] || '';
    if (!out.happy) out.happy = out.normal;
    if (!out.shy) out.shy = out.normal;
    if (!out.surprised) out.surprised = out.normal;
    if (!out.angry) out.angry = out.normal;
    return out;
  }

  throw new Error('必须上传男主照片');
};

const generateHeroineSet = async (input: StartGameGenerationInput, opts?: { standardVariant?: 1 | 2 }) => {
  const mimeType = input.heroineMimeType || 'image/jpeg';

  if (input.heroinePhotoBase64) {
    const isStandard1 = opts?.standardVariant === 1;
    const emotionSet: Array<keyof GeneratedAssets['heroine']> = isStandard1
      ? ['normal', 'happy', 'shy']
      : ['normal', 'shy', 'happy', 'surprised'];
    const urls = await generateSpriteSet(emotionSet, input.heroinePhotoBase64, mimeType, true);
    const images = await Promise.all(urls.map(downloadToBase64));
    const out: any = {};
    emotionSet.forEach((key, i) => {
      out[key] = images[i] || images[0] || '';
    });
    if (!out.normal) out.normal = images[0] || '';
    if (!out.happy) out.happy = out.normal;
    if (!out.shy) out.shy = out.normal;
    if (!out.surprised) out.surprised = out.normal;
    if (!out.angry) out.angry = out.normal;
    if (!out.sad) out.sad = out.shy || out.normal;
    return out;
  }

  throw new Error('女主照片必传');
};

const generateBackgrounds = async (
  scenes: Array<{ name: string; prompt: string }>,
  onProgress: (done: number) => Promise<void>
) => {
  const backgrounds: Record<string, string> = {};
  let done = 0;
  const results = await Promise.all(
    scenes.map(async (scene) => {
      try {
        const url = await generateBackgroundImage(scene.prompt || scene.name);
        const base64 = await downloadToBase64(url);
        return { key: scene.name, base64 };
      } finally {
        done += 1;
        await onProgress(done);
      }
    })
  );

  results.forEach((r) => {
    if (r?.key && r?.base64) backgrounds[r.key] = r.base64;
  });

  return backgrounds;
};

const getOrderedNodes = (script: GameScript): StoryNode[] => {
  const order: StoryNode[] = [];
  const visited = new Set<string>();
  let currentId = script.startNodeId;
  while (currentId && !visited.has(currentId)) {
    const node = script.nodes[currentId];
    if (!node) break;
    visited.add(currentId);
    order.push(node);
    currentId = node.nextNodeId || '';
  }
  return order;
};

const pickHeroineVoiceLines = (script: GameScript, count: number) => {
  const nodes = getOrderedNodes(script);
  const lines: Array<{ nodeId: string; text: string }> = [];
  for (const node of nodes) {
    if (node.speaker !== SpeakerType.HEROINE) continue;
    const text = (node.textJP || node.textCN || '').trim();
    if (!text) continue;
    lines.push({ nodeId: node.id, text });
    if (lines.length >= count) break;
  }
  return lines;
};

const generateHeroineVoiceMap = async (
  script: GameScript,
  onUpdate: (patch: { progress?: number; message?: string }) => Promise<void>
) => {
  const lines = pickHeroineVoiceLines(script, 3);
  if (lines.length === 0) return {};

  const voice: Record<string, string> = {};
  for (let i = 0; i < lines.length; i += 1) {
    await onUpdate({ progress: 84 + Math.round((i / lines.length) * 6), message: `正在生成女主语音（${i + 1}/${lines.length}）` });
    try {
      const result = await generateHeroineTts({ text: lines[i].text });
      voice[lines[i].nodeId] = result.dataUrl;
    } catch (err) {
      console.warn('generate heroine tts failed', err);
    }
  }
  return voice;
};

const buildGamePayload = async (
  input: StartGameGenerationInput,
  onUpdate: (patch: { progress?: number; message?: string }) => Promise<void>
): Promise<GeneratedGamePayload> => {
  const isMax = input.maxMode === true || input.maxMode === 1 || input.maxMode === '1';
  const standardVariant = isMax ? undefined : input.standardVariant === 1 ? 1 : 2;
  const isStandard1 = !isMax && standardVariant === 1;
  const protagonistName = String(input.protagonistName || '').trim() || '我';
  const heroineName = String(input.heroineName || '').trim() || 'Unit-01';
  const plotDescription = String(input.plotDescription || '').trim();
  const heroinePhotoBase64 = typeof input.heroinePhotoBase64 === 'string' ? input.heroinePhotoBase64.trim() : '';
  if (!heroinePhotoBase64) throw new Error('女主照片必传');

  await onUpdate({ progress: 2, message: '正在准备生成任务' });

  const scenesPromise = (async () => {
    if (isStandard1) {
      await onUpdate({ progress: 8, message: '使用默认校园背景' });
      return [{ name: DEFAULT_CAMPUS_KEY, prompt: DEFAULT_CAMPUS_KEY }];
    }
    await onUpdate({ progress: 8, message: '正在推测场景' });
    const scenes = await inferBackgroundScenes(plotDescription);
    const cleaned = sanitizeScenes(scenes).slice(0, isMax ? 3 : 2);
    if (cleaned.length === 0) throw new Error('场景推测失败，请换个更具体的场景描述重试');
    return cleaned;
  })();

  const protagonistPromise = (async () => {
    if (!isMax || !input.protagonistPhotoBase64) {
      await onUpdate({ progress: 12, message: '跳过男主立绘' });
      return { normal: '', happy: '', surprised: '', angry: '', shy: '' };
    }
    await onUpdate({ progress: 12, message: '正在生成主角立绘' });
    return await generateProtagonistSet(input);
  })();

  const heroinePromise = (async () => {
    await onUpdate({ progress: 20, message: `正在生成女主立绘（${heroineName}）` });
    return await generateHeroineSet(input, { standardVariant });
  })();

  const scenes = await scenesPromise;

  const backgroundsPromise = (async () => {
    if (isStandard1) {
      await onUpdate({ progress: 40, message: '加载默认背景（随机）' });
      const base64 = await getRandomStandard1BackgroundBase64();
      await onUpdate({ progress: 75, message: '默认背景已就绪' });
      return { [DEFAULT_CAMPUS_KEY]: base64 };
    }
    await onUpdate({ progress: 40, message: `正在生成背景（0/${scenes.length}）` });
    return await generateBackgrounds(scenes, async (done) => {
      const base = 40;
      const span = 35;
      const pct = base + Math.round((done / Math.max(1, scenes.length)) * span);
      await onUpdate({ progress: pct, message: `正在生成背景（${done}/${scenes.length}）` });
    });
  })();

  const scriptPromise = (async () => {
    await onUpdate({ progress: 78, message: '正在生成剧本' });
    const heroineEmotions: Array<StoryNode['emotion']> = isStandard1 ? ['normal', 'happy', 'shy'] : ['normal', 'shy', 'happy', 'surprised'];
    const hasProtagonistSprite = isMax && !!input.protagonistPhotoBase64;
    const protagonistEmotions: Array<StoryNode['emotion']> = hasProtagonistSprite
      ? ['normal', 'happy', 'shy']
      : heroineEmotions;
    const script = await generateScript(protagonistName, heroineName, plotDescription, {
      backgroundScenes: scenes,
      emotionGuide: {
        heroineEmotions,
        protagonistEmotions,
        hasProtagonistSprite,
      },
    });
    const titleFromUser = plotDescription.length > 0 ? plotDescription : script.title;
    const generationVariant: GameScript['generationVariant'] = isMax ? 'max' : isStandard1 ? 'standard1' : 'standard2';
    return {
      ...script,
      title: titleFromUser,
      maxMode: isMax,
      generationVariant,
    };
  })();

  const voicePromise = (async () => {
    if (isStandard1) {
      await onUpdate({ progress: 84, message: '普通生成1：跳过语音' });
      return {};
    }
    const script = await scriptPromise;
    return await generateHeroineVoiceMap(script, onUpdate);
  })();

  const [script, protagonist, heroine, backgrounds, voice] = await Promise.all([
    scriptPromise,
    protagonistPromise,
    heroinePromise,
    backgroundsPromise,
    voicePromise,
  ]);

  await onUpdate({ progress: 94, message: '正在整理生成结果' });

  const userProfile: UserProfile = {
    name: protagonistName,
    avatarBase64:
      input.protagonistPhotoBase64 ||
      input.heroinePhotoBase64 ||
      String((protagonist as any).normal || ''),
  };

  const assets: GeneratedAssets = {
    protagonist: protagonist as any,
    heroine: heroine as any,
    backgrounds,
    music: {},
    voice,
  };

  await onUpdate({ progress: 100, message: '生成完成' });

  return {
    script,
    assets,
    userProfile,
    initialNodeId: script.startNodeId,
    initialAffinity: 50,
  };
};

export const createGenerationJobId = () => crypto.randomUUID();

export const startGameGenerationJob = async (params: {
  userId: string;
  jobId: string;
  input: StartGameGenerationInput;
  coinCost: number;
}): Promise<{ accepted: boolean }> => {
  const { userId, jobId, input, coinCost } = params;
  await createJob<GeneratedGamePayload>(userId, jobId, '排队中');
  try {
    await createGenerationJobRecord({
      id: jobId,
      userId,
      input,
      coinCost,
      message: '排队中',
    });
  } catch {}

  const run = async () => {
    try {
      await updateJob<GeneratedGamePayload>(userId, jobId, {
        state: 'running',
        progress: 1,
        message: '开始生成…',
      });
      await updateGenerationJobRecord(userId, jobId, {
        status: 'running',
        progress: 1,
        message: '开始生成…',
      }).catch(() => {});

      const { result, debug } = await withAiDebug(() =>
        buildGamePayload(input, async (patch) => {
          await updateJob<GeneratedGamePayload>(userId, jobId, {
            state: 'running',
            ...(typeof patch.progress === 'number' ? { progress: patch.progress } : {}),
            ...(typeof patch.message === 'string' ? { message: patch.message } : {}),
          });
          await updateGenerationJobRecord(userId, jobId, {
            status: 'running',
            ...(typeof patch.progress === 'number' ? { progress: patch.progress } : {}),
            ...(typeof patch.message === 'string' ? { message: patch.message } : {}),
          }).catch(() => {});
        })
      );

      try {
        const save = await createSave({
          userId,
          script: result.script,
          assets: result.assets,
          userProfile: result.userProfile,
          currentNodeId: result.initialNodeId,
          affinity: result.initialAffinity,
        });
        await updateGenerationJobRecord(userId, jobId, {
          resultSaveId: save.id,
        }).catch(() => {});
      } catch (err) {
        console.warn('auto-save generated game failed', err);
      }

      await updateJob<GeneratedGamePayload>(userId, jobId, {
        state: 'completed',
        progress: 100,
        message: '生成完成',
        result,
        ...(debug ? { debug } : {}),
      });
      await updateGenerationJobRecord(userId, jobId, {
        status: 'completed',
        progress: 100,
        message: '生成完成',
      }).catch(() => {});
    } catch (err: any) {
      const message = err?.message || '生成失败';
      try {
        await refundUserCoins(userId, coinCost);
      } catch {}
      await updateJob<GeneratedGamePayload>(userId, jobId, {
        state: 'failed',
        progress: 100,
        message: '生成失败',
        error: message,
      });
      await updateGenerationJobRecord(userId, jobId, {
        status: 'failed',
        progress: 100,
        message: '生成失败',
        error: message,
        refundedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  };

  const queued = enqueueGenerationJob(run);
  if (!queued.accepted) {
    await updateJob<GeneratedGamePayload>(userId, jobId, {
      state: 'failed',
      progress: 100,
      message: '排队失败',
      error: '服务器繁忙，请稍后再试',
    });
    await updateGenerationJobRecord(userId, jobId, {
      status: 'failed',
      progress: 100,
      message: '排队失败',
      error: '服务器繁忙，请稍后再试',
      refundedAt: new Date().toISOString(),
    }).catch(() => {});
    return { accepted: false };
  }

  if (!queued.started && queued.position > 1) {
    await updateJob<GeneratedGamePayload>(userId, jobId, {
      state: 'queued',
      progress: 0,
      message: `排队中（前面还有 ${queued.position - 1} 个任务）`,
    });
    await updateGenerationJobRecord(userId, jobId, {
      status: 'queued',
      progress: 0,
      message: `排队中（前面还有 ${queued.position - 1} 个任务）`,
    }).catch(() => {});
  }

  return { accepted: true };
};
