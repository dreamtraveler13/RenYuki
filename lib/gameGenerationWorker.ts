import crypto from 'crypto';
import { GeneratedAssets, GameScript, UserProfile } from '@/types';
import { createJob, updateJob } from '@/lib/gameGenerationCache';
import {
  generateBackgroundImage,
  generateHeroine,
  generateProtagonist,
  generateScript,
  inferBackgroundScenes,
  withAiDebug,
} from '@/lib/aiServer';
import { refundUserCoins } from '@/lib/userStore';

export interface StartGameGenerationInput {
  protagonistName: string;
  heroineName?: string;
  plotDescription: string;
  maxMode?: boolean | 0 | 1 | '0' | '1';
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

const generateProtagonistSet = async (input: StartGameGenerationInput) => {
  const isMax = input.maxMode === true || input.maxMode === 1 || input.maxMode === '1';
  const mimeType = input.protagonistMimeType || 'image/jpeg';

  if (input.protagonistPhotoBase64) {
    const emotionSet = isMax
      ? [
          ['normal', 'confident smile'],
          ['happy', 'bright happy smile'],
          ['surprised', 'surprised, jaw drop, shock'],
          ['angry', 'annoyed, angry, slightly frowning'],
        ]
      : [
          ['normal', 'confident smile'],
          ['surprised', 'surprised, jaw drop, shock'],
        ];

    const urls = await Promise.all(
      emotionSet.map(([, emotion]) => generateProtagonist(emotion as string, input.protagonistPhotoBase64, undefined, mimeType))
    );
    const images = await Promise.all(urls.map(downloadToBase64));
    const out: any = {};
    emotionSet.forEach(([key], i) => {
      out[key] = images[i];
    });
    if (!out.happy) out.happy = out.normal;
    if (!out.angry) out.angry = out.surprised || out.normal;
    if (!out.shy) out.shy = out.happy;
    return out;
  }

  const normalUrl = await generateProtagonist('confident smile');
  const normal = await downloadToBase64(normalUrl);

  if (isMax) {
    const [happyUrl, surprisedUrl, angryUrl] = await Promise.all([
      generateProtagonist('bright happy smile', undefined, normal),
      generateProtagonist('surprised, jaw drop, shock', undefined, normal),
      generateProtagonist('annoyed, angry, slightly frowning', undefined, normal),
    ]);
    const [happy, surprised, angry] = await Promise.all([
      downloadToBase64(happyUrl),
      downloadToBase64(surprisedUrl),
      downloadToBase64(angryUrl),
    ]);
    return { normal, happy, surprised, angry, shy: happy };
  }

  const surprisedUrl = await generateProtagonist('surprised, jaw drop, shock', undefined, normal);
  const surprised = await downloadToBase64(surprisedUrl);
  return { normal, happy: normal, surprised, angry: surprised, shy: normal };
};

const generateHeroineSet = async (input: StartGameGenerationInput) => {
  const isMax = input.maxMode === true || input.maxMode === 1 || input.maxMode === '1';
  const mimeType = input.heroineMimeType || 'image/jpeg';

  if (input.heroinePhotoBase64) {
    const emotionSet = isMax
      ? [
          ['normal', 'gentle smile'],
          ['happy', 'laughing happily'],
          ['shy', 'blushing shy'],
          ['surprised', 'surprised, wide eyes, slight gasp'],
          ['angry', 'pouting, angry, cheeks slightly puffed'],
          ['sad', 'sad, watery eyes, holding back tears'],
        ]
      : [
          ['normal', 'gentle smile'],
          ['happy', 'laughing happily'],
          ['shy', 'blushing shy'],
        ];

    const urls = await Promise.all(
      emotionSet.map(([, emotion]) => generateHeroine(emotion as string, undefined, input.heroinePhotoBase64, mimeType))
    );
    const images = await Promise.all(urls.map(downloadToBase64));
    const out: any = {};
    emotionSet.forEach(([key], i) => {
      out[key] = images[i];
    });
    if (!out.surprised) out.surprised = out.normal;
    if (!out.angry) out.angry = out.normal;
    return out;
  }

  const normalUrl = await generateHeroine('gentle smile');
  const normal = await downloadToBase64(normalUrl);

  if (isMax) {
    const [happyUrl, shyUrl, surprisedUrl, angryUrl, sadUrl] = await Promise.all([
      generateHeroine('laughing happily', normal, undefined),
      generateHeroine('blushing shy', normal, undefined),
      generateHeroine('surprised, wide eyes, slight gasp', normal, undefined),
      generateHeroine('pouting, angry, cheeks slightly puffed', normal, undefined),
      generateHeroine('sad, watery eyes, holding back tears', normal, undefined),
    ]);
    const [happy, shy, surprised, angry, sad] = await Promise.all([
      downloadToBase64(happyUrl),
      downloadToBase64(shyUrl),
      downloadToBase64(surprisedUrl),
      downloadToBase64(angryUrl),
      downloadToBase64(sadUrl),
    ]);
    return { normal, happy, shy, surprised, angry, sad };
  }

  const [happyUrl, shyUrl] = await Promise.all([
    generateHeroine('laughing happily', normal, undefined),
    generateHeroine('blushing shy', normal, undefined),
  ]);
  const [happy, shy] = await Promise.all([downloadToBase64(happyUrl), downloadToBase64(shyUrl)]);
  return { normal, happy, shy, surprised: normal, angry: normal };
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

const buildGamePayload = async (
  input: StartGameGenerationInput,
  onUpdate: (patch: { progress?: number; message?: string }) => Promise<void>
): Promise<GeneratedGamePayload> => {
  const protagonistName = String(input.protagonistName || '').trim();
  const heroineName = String(input.heroineName || '').trim() || 'Unit-01';
  const plotDescription = String(input.plotDescription || '').trim();

  await onUpdate({ progress: 2, message: '正在准备生成任务' });

  const scenesPromise = (async () => {
    await onUpdate({ progress: 8, message: '正在推测场景' });
    const scenes = await inferBackgroundScenes(plotDescription);
    const cleaned = sanitizeScenes(scenes);
    if (cleaned.length === 0) throw new Error('场景推测失败，请换个更具体的场景描述重试');
    return cleaned;
  })();

  const protagonistPromise = (async () => {
    await onUpdate({ progress: 12, message: '正在生成主角立绘' });
    return await generateProtagonistSet(input);
  })();

  const heroinePromise = (async () => {
    await onUpdate({ progress: 20, message: `正在生成女主立绘（${heroineName}）` });
    return await generateHeroineSet(input);
  })();

  const scenes = await scenesPromise;

  const backgroundsPromise = (async () => {
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
    const script = await generateScript(protagonistName, heroineName, plotDescription, {
      backgroundScenes: scenes,
    });
    const titleFromUser = plotDescription.length > 0 ? plotDescription : script.title;
    return { ...script, title: titleFromUser };
  })();

  const [script, protagonist, heroine, backgrounds] = await Promise.all([
    scriptPromise,
    protagonistPromise,
    heroinePromise,
    backgroundsPromise,
  ]);

  await onUpdate({ progress: 94, message: '正在整理生成结果' });

  const userProfile: UserProfile = {
    name: protagonistName,
    avatarBase64: input.protagonistPhotoBase64 || String((protagonist as any).normal || ''),
  };

  const assets: GeneratedAssets = {
    protagonist: protagonist as any,
    heroine: heroine as any,
    backgrounds,
    music: {},
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
}) => {
  const { userId, jobId, input, coinCost } = params;
  await createJob<GeneratedGamePayload>(userId, jobId, '任务已创建，准备生成…');

  const run = async () => {
    try {
      await updateJob<GeneratedGamePayload>(userId, jobId, {
        state: 'running',
        progress: 1,
        message: '开始生成…',
      });

      const { result, debug } = await withAiDebug(() =>
        buildGamePayload(input, async (patch) => {
          await updateJob<GeneratedGamePayload>(userId, jobId, {
            state: 'running',
            ...(typeof patch.progress === 'number' ? { progress: patch.progress } : {}),
            ...(typeof patch.message === 'string' ? { message: patch.message } : {}),
          });
        })
      );

      await updateJob<GeneratedGamePayload>(userId, jobId, {
        state: 'completed',
        progress: 100,
        message: '生成完成',
        result,
        ...(debug ? { debug } : {}),
      });
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
    }
  };

  void run();
};
