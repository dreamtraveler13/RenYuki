'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CharacterImages, GameScript, GeneratedAssets, UserProfile } from '../types';
import Button from './Button';
import { fileToBase64, generateGameScript, generateImage, generateProtagonistSprite, generateHeroineSprite, inferScenes } from '../services/aiService';
import { policyAccept, policyStatus, walletBalance } from '../services/accountService';
import { saveGame } from '../services/storageService';

interface Props {
  onGameReady: (script: GameScript, assets: GeneratedAssets, user: UserProfile) => void;
  onCoinsUpdated?: (coins: number) => void;
  onNeedCoins?: () => void;
  onCancel: () => void;
}

// BGM Library (Mapped to files in "public/music/")
// Ensure files song1.mp3 to song7.mp3 exist in your "public/music/" folder.
const AUDIO_LIBRARY: Record<string, string> = {
  bgm_bossa: "/music/song1.mp3",   // 轻松爵士 (Bossa Nova)
  bgm_playful: "/music/song2.mp3", // 俏皮管弦
  bgm_piano: "/music/song3.mp3",   // 温暖钢琴
  bgm_night: "/music/song4.mp3",   // 深夜慢摇
  bgm_sad: "/music/song5.mp3",     // 悲伤独奏
  bgm_dream: "/music/song6.mp3",   // 梦幻八音盒
  bgm_morning: "/music/song7.mp3"  // 优雅晨曲
};

// 简易扣图（基于画布洪水填充 + 羽化）
const removeBackground = async (base64Data: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    const trimmed = typeof base64Data === 'string' ? base64Data.trim() : '';
    const src = trimmed.startsWith('data:')
      ? trimmed
      : trimmed.startsWith('/9j')
        ? `data:image/jpeg;base64,${trimmed}`
        : `data:image/png;base64,${trimmed}`;
    img.src = src;
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Data);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const width = canvas.width;
      const height = canvas.height;

      const visited = new Uint8Array(width * height);
      const stack: number[] = [];

      const START_THRESHOLD = 240;
      const FILL_THRESHOLD = 240;
      const getBrightness = (idx: number) => (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const isBackgroundCandidate = (idx: number) => {
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        return r > FILL_THRESHOLD && g > FILL_THRESHOLD && b > FILL_THRESHOLD;
      };

      const corners = [0, width - 1, (height - 1) * width, width * height - 1];
      for (const idx of corners) {
        if (getBrightness(idx * 4) > START_THRESHOLD) {
          stack.push(idx);
          visited[idx] = 1;
        }
      }

      while (stack.length > 0) {
        const idx = stack.pop()!;
        const x = idx % width;
        const y = Math.floor(idx / width);
        const neighbors = [];
        if (x > 0) neighbors.push(idx - 1);
        if (x < width - 1) neighbors.push(idx + 1);
        if (y > 0) neighbors.push(idx - width);
        if (y < height - 1) neighbors.push(idx + width);
        for (const nIdx of neighbors) {
          if (visited[nIdx] === 0) {
            const pixelIdx = nIdx * 4;
            if (isBackgroundCandidate(pixelIdx)) {
              visited[nIdx] = 1;
              stack.push(nIdx);
            } else {
              visited[nIdx] = 2;
            }
          }
        }
      }

      for (let i = 0; i < width * height; i++) {
        const pixelIdx = i * 4;
        if (visited[i] === 1) {
          data[pixelIdx + 3] = 0;
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const newBase64 = canvas.toDataURL('image/png').split(',')[1];
      resolve(newBase64);
    };
    img.onerror = () => resolve(base64Data);
  });
};

const fetchAudioToBase64 = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
        console.warn(`Audio file missing: ${url} (Status: ${response.status})`);
        return "";
    }
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn(`Audio fetch failed for ${url}`, e);
    return "";
  }
};

const POLICY_TEXT = `用户须知与免责声明（强制阅读）

1. 性质与用途
- 本站提供 AI 生成内容的演示与娱乐服务，仅供个人学习、创作参考与娱乐体验。
- 生成内容具有不确定性，可能包含错误或不当信息，不构成任何事实陈述或官方立场。

2. 严格禁止内容（重点）
你承诺绝不上传、输入、引导或生成（包括文字/图片/音频/链接/暗示性指令/变体拼写/谐音/截图/二维码等规避形式）：
- 任何违反中华人民共和国法律法规及相关规定的内容；
- 任何政治敏感信息、煽动性内容、谣言、极端化内容；
- 色情、涉未成年人不当内容、暴力血腥、恐怖、赌博、毒品、诈骗、侵权盗版、违法交易、个人隐私泄露等；
- 任何可能引发人身伤害、自残自杀、违法犯罪的指令或教程。

3. 用户责任与承诺
- 你对你上传/输入的全部内容及其合法性承担全部责任。
- 你确认拥有上传素材的合法权利（著作权/肖像权/授权等），并保证不侵犯任何第三方合法权益。
- 因你上传/输入/传播内容引发的争议、投诉、处罚或损失，由你自行承担并负责解决。

4. 平台管理措施
- 平台可能对输入与输出进行自动化审核、过滤、拦截与记录，以履行合规与安全义务。
- 若你尝试生成禁止内容，平台将采取警告、限制功能、封禁账号等措施；你同意平台对此拥有最终处置权。

5. 输出内容的使用限制
- 你不得将本站生成内容用于违法用途、对外传播敏感信息、误导公众或造成社会影响的场景。
- 你不得声称生成内容来自官方/权威机构，不得用于冒充、诽谤、造谣或侵害他人名誉。

6. 免责与责任限制
- 平台不保证生成内容的准确性、完整性、合法性或适用性；你应自行判断并承担使用后果。
- 因不可抗力、网络故障、第三方服务故障、模型不稳定等导致的中断或损失，平台在法律允许范围内不承担责任。

7. 同意与生效
- 你点击“我已阅读并同意”即表示已完整阅读并理解本声明全部条款，并同意接受约束。
- 若不同意，请停止使用并退出。`;

const PolicyModal: React.FC<{
  open: boolean;
  version: number | null;
  onDecline: () => void;
  onAccepted: (version: number) => Promise<void>;
}> = ({ open, version, onDecline, onAccepted }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setScrolledToBottom(false);
    setChecked(false);
    setSubmitting(false);
    setError(null);
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[25000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overlay-fade-in">
      <div className="w-full max-w-2xl bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.18)] overflow-hidden modal-scale-in">
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">首次生成前请阅读并同意免责声明</div>
          <button onClick={onDecline} className="text-xl leading-none text-gray-500 hover:text-gray-900 transition-colors">
            ×
          </button>
        </div>
        <div
          ref={boxRef}
          className="max-h-[60vh] overflow-y-auto px-5 py-4 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap"
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 6;
            if (atBottom) setScrolledToBottom(true);
          }}
        >
          {POLICY_TEXT}
        </div>
        <div className="px-5 py-4 border-t border-black/10 space-y-3">
          <label className="flex items-start gap-2 text-xs text-gray-700 select-none">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5"
              disabled={!scrolledToBottom || submitting}
            />
            <span>
              我已完整阅读并同意上述免责声明（版本 {version ?? '-'}），并承诺不生成任何违法/政治敏感等禁止内容。
            </span>
          </label>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button
              onClick={async () => {
                if (!scrolledToBottom) {
                  setError('请先滚动到最底部后再继续。');
                  return;
                }
                if (!checked) {
                  setError('请勾选“我已阅读并同意”。');
                  return;
                }
                if (!version) {
                  setError('免责声明版本获取失败，请刷新页面重试。');
                  return;
                }
                setSubmitting(true);
                setError(null);
                try {
                  await onAccepted(version);
                } catch (e: any) {
                  setError(e?.message || '提交失败，请稍后重试。');
                  setSubmitting(false);
                  return;
                }
                setSubmitting(false);
              }}
              className="w-full"
            >
              {submitting ? '提交中…' : '我已阅读并同意'}
            </Button>
            <Button onClick={onDecline} variant="secondary" className="w-full">
              暂不同意（返回）
            </Button>
          </div>
          <div className="text-[10px] text-gray-500">
            为合规与安全，平台会记录同意时间与免责声明版本号，并可能记录必要的安全日志。
          </div>
        </div>
      </div>
    </div>
  );
};

type TourStep = {
  key: string;
  title: string;
  body: string;
  getEl: () => HTMLElement | null;
};

const TOUR_SEEN_KEY = 'ry_wizard_tour_seen_v1';

const OnboardingTour: React.FC<{
  open: boolean;
  steps: TourStep[];
  stepIndex: number;
  onStepIndex: (idx: number) => void;
  onClose: (markSeen: boolean) => void;
}> = ({ open, steps, stepIndex, onStepIndex, onClose }) => {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
    const el = steps[stepIndex]?.getEl?.() || null;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [open, stepIndex, steps]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let cancelled = false;
    let last: DOMRect | null = null;

    const tick = () => {
      if (cancelled) return;
      const el = steps[stepIndex]?.getEl?.() || null;
      const next = el ? el.getBoundingClientRect() : null;
      const changed =
        (!last && !!next) ||
        (!!last && !next) ||
        (!!last &&
          !!next &&
          (Math.abs(last.top - next.top) > 0.5 ||
            Math.abs(last.left - next.left) > 0.5 ||
            Math.abs(last.width - next.width) > 0.5 ||
            Math.abs(last.height - next.height) > 0.5));
      if (changed) {
        setRect(next);
        last = next;
      }
      raf = window.requestAnimationFrame(tick);
    };

    tick();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [open, stepIndex, steps]);

  useEffect(() => {
    if (!open) return;
    const handleResize = () => setRect(steps[stepIndex]?.getEl?.()?.getBoundingClientRect?.() || null);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [open, stepIndex, steps]);

  if (!open) return null;
  const step = steps[stepIndex];
  const progress = `${stepIndex + 1} / ${steps.length}`;

  const safeRect = rect
    ? {
        top: Math.max(0, rect.top - 6),
        left: Math.max(0, rect.left - 6),
        width: rect.width + 12,
        height: rect.height + 12,
      }
    : null;

  const tooltipTop = safeRect
    ? Math.min(window.innerHeight - 220, safeRect.top + safeRect.height + 14)
    : Math.round(window.innerHeight / 2 - 120);
  const tooltipLeft = safeRect
    ? Math.min(window.innerWidth - 320, Math.max(12, safeRect.left))
    : Math.round(window.innerWidth / 2 - 160);

  return (
    <div className="fixed inset-0 z-[26000] overlay-fade-in">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => onClose(false)} />
      {safeRect && (
        <div
          className="absolute rounded-2xl border border-white/25 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-all duration-300 ease-out"
          style={{
            top: safeRect.top,
            left: safeRect.left,
            width: safeRect.width,
            height: safeRect.height,
          }}
        />
      )}
      <div
        className="absolute w-[min(92vw,420px)] bg-white text-black rounded-3xl border border-black/10 shadow-[0_30px_90px_rgba(0,0,0,0.18)] p-5 modal-scale-in"
        style={{ top: tooltipTop, left: tooltipLeft }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-mono-tech text-gray-500">{progress}</div>
            <div className="mt-1 text-base font-semibold text-gray-900">{step?.title || '引导'}</div>
          </div>
          <button
            onClick={() => onClose(true)}
            className="text-gray-500 hover:text-gray-900 transition-colors text-xl leading-none"
            aria-label="关闭引导"
          >
            ×
          </button>
        </div>
        <div className="mt-3 text-sm text-gray-700 leading-relaxed">{step?.body}</div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            onClick={() => onClose(true)}
            className="text-xs font-mono-tech text-gray-500 hover:text-gray-900 transition-colors"
          >
            跳过
          </button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => onStepIndex(Math.max(0, stepIndex - 1))}
              className="rounded-2xl border-black/10 px-4 py-2"
              disabled={stepIndex === 0}
            >
              上一步
            </Button>
            <Button
              onClick={() => {
                if (stepIndex >= steps.length - 1) {
                  onClose(true);
                  return;
                }
                onStepIndex(stepIndex + 1);
              }}
              className="rounded-2xl border-black/10 px-4 py-2"
            >
              {stepIndex >= steps.length - 1 ? '完成' : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const GameCreationWizard: React.FC<Props> = ({ onGameReady, onCoinsUpdated, onNeedCoins, onCancel }) => {
  const mountedRef = useRef(true);
  const [step, setStep] = useState<'upload' | 'generating'>('upload');
  const [loadingStatus, setLoadingStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const [userName, setUserName] = useState('');
  const [heroineName, setHeroineName] = useState('');
  const [plotDescription, setPlotDescription] = useState('');
  const [maxMode, setMaxMode] = useState(false);

  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyVersion, setPolicyVersion] = useState<number | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);
  
  const [protagonistPhoto, setProtagonistPhoto] = useState<string | undefined>(undefined);
  const [protagonistMimeType, setProtagonistMimeType] = useState<string>('image/jpeg');

  const [heroinePhoto, setHeroinePhoto] = useState<string | undefined>(undefined);
  const [heroineMimeType, setHeroineMimeType] = useState<string>('image/jpeg');

  const plotRef = useRef<HTMLTextAreaElement | null>(null);
  const protagonistNameRef = useRef<HTMLInputElement | null>(null);
  const protagonistUploadRef = useRef<HTMLDivElement | null>(null);
  const heroineNameRef = useRef<HTMLInputElement | null>(null);
  const heroineUploadRef = useRef<HTMLDivElement | null>(null);
  const maxModeRef = useRef<HTMLLabelElement | null>(null);
  const startButtonWrapRef = useRef<HTMLDivElement | null>(null);

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        key: 'plot',
        title: '1) 场景设定',
        body: '写一句你想要的开场设定即可。越具体越好（时间/地点/氛围/事件）。',
        getEl: () => plotRef.current,
      },
      {
        key: 'protagonist-name',
        title: '2) 主角名字（必填）',
        body: '只要填了主角名字，就能开始生成。',
        getEl: () => protagonistNameRef.current,
      },
      {
        key: 'protagonist-photo',
        title: '3) 主角照片（可选）',
        body: '可上传一张照片，让主角更像你；不上传也没关系。',
        getEl: () => protagonistUploadRef.current,
      },
      {
        key: 'heroine',
        title: '4) 女主角（可选）',
        body: '女主名字可留空（默认 Unit-01）。也可以上传照片来决定外观。',
        getEl: () => heroineNameRef.current || heroineUploadRef.current,
      },
      {
        key: 'max-mode',
        title: '5) MAX MODE',
        body: '开启后消耗 2 个嘎拉币（普通 1 个），立绘更多更精细。随时可切换。',
        getEl: () => maxModeRef.current,
      },
      {
        key: 'start',
        title: '6) 开始生成',
        body: '点击开始后会进入全屏生成界面，期间请保持页面打开。',
        getEl: () => startButtonWrapRef.current,
      },
    ],
    []
  );


  const handleProtagonistUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const base64 = await fileToBase64(file);
      setProtagonistPhoto(base64);
      setProtagonistMimeType(file.type || 'image/jpeg');
    }
  };

  const handleHeroineUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const base64 = await fileToBase64(file);
      setHeroinePhoto(base64);
      setHeroineMimeType(file.type || 'image/jpeg');
    }
  };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 'upload') return;
    if (showPolicyModal) return;
    if (errorMessage) return;
    try {
      const seen = window.localStorage.getItem(TOUR_SEEN_KEY);
      if (!seen) {
        setShowTour(true);
        setTourStepIndex(0);
      }
    } catch {}
  }, [step, showPolicyModal, errorMessage]);

  const handleStart = async () => {
    if (!userName) return;

    if (!policyAccepted) {
      try {
        const status = await policyStatus();
        setPolicyVersion(status.policyVersion);
        if (!status.accepted) {
          setShowPolicyModal(true);
          return;
        }
        setPolicyAccepted(true);
      } catch {
        setPolicyVersion(1);
        setShowPolicyModal(true);
        return;
      }
    }

    if (mountedRef.current) {
      setErrorMessage('');
      setStep('generating');
    }

    try {
      const targetHeroine = heroineName.trim() || "Unit-01";

      // 1) Start sprites + scene inference in parallel
      const scenePromise = (async () => {
        if (mountedRef.current) setLoadingStatus('正在推测场景');
        const scenes = await inferScenes(plotDescription || '');
        const cleaned = Array.isArray(scenes)
          ? scenes
              .filter((s) => s && typeof s === 'object')
              .map((s) => ({
                name: typeof (s as any).name === 'string' ? (s as any).name.trim() : '',
                prompt: typeof (s as any).prompt === 'string' ? (s as any).prompt.trim() : '',
              }))
              .filter((s) => s.name.length > 0)
              .slice(0, 3)
          : [];

        const seen = new Set<string>();
        const deduped = cleaned.filter((s) => {
          if (seen.has(s.name)) return false;
          seen.add(s.name);
          return true;
        });
        const out = deduped.map((s) => ({ name: s.name, prompt: s.prompt || s.name }));
        if (out.length === 0) {
          throw new Error('场景推测失败，请换个更具体的场景描述重试');
        }
        return out;
      })();

      const scriptPromise = (async () => {
        const scenes = await scenePromise;
        if (mountedRef.current) setLoadingStatus('正在生成剧本');
        return await generateGameScript(
          userName,
          targetHeroine,
          plotDescription,
          maxMode,
          scenes.length > 0 ? scenes : undefined
        );
      })();

      const backgroundsPromise = (async () => {
        const scenes = await scenePromise;
        const backgrounds: Record<string, string> = {};
        let bgDone = 0;
        if (mountedRef.current) setLoadingStatus(`正在生成背景（${bgDone}/${scenes.length}）`);

        const results = await Promise.all(
          scenes.map(async (scene) => {
            try {
              const img = await generateImage(scene.prompt || scene.name);
              return { key: scene.name, img };
            } finally {
              bgDone += 1;
              if (mountedRef.current) setLoadingStatus(`正在生成背景（${bgDone}/${scenes.length}）`);
            }
          })
        );

        results.forEach((r) => {
          if (r?.key && r?.img) backgrounds[r.key] = r.img;
        });

        return backgrounds;
      })();

      const protagonistPromise: Promise<CharacterImages> = (async () => {
        if (mountedRef.current) setLoadingStatus('正在生成主角立绘');

        if (protagonistPhoto) {
          if (maxMode) {
            const [normal, happy, surprised, angry] = await Promise.all([
              generateProtagonistSprite('confident smile', protagonistPhoto, undefined, protagonistMimeType),
              generateProtagonistSprite('bright happy smile', protagonistPhoto, undefined, protagonistMimeType),
              generateProtagonistSprite('surprised, jaw drop, shock', protagonistPhoto, undefined, protagonistMimeType),
              generateProtagonistSprite('annoyed, angry, slightly frowning', protagonistPhoto, undefined, protagonistMimeType),
            ]);
            return { normal, happy, surprised, angry, shy: happy };
          }

          const [normal, surprised] = await Promise.all([
            generateProtagonistSprite('confident smile', protagonistPhoto, undefined, protagonistMimeType),
            generateProtagonistSprite('surprised, jaw drop, shock', protagonistPhoto, undefined, protagonistMimeType),
          ]);
          return { normal, happy: normal, surprised, angry: surprised, shy: normal };
        }

        const normal = await generateProtagonistSprite('confident smile');
        if (maxMode) {
          const [happy, surprised, angry] = await Promise.all([
            generateProtagonistSprite('bright happy smile', undefined, normal),
            generateProtagonistSprite('surprised, jaw drop, shock', undefined, normal),
            generateProtagonistSprite('annoyed, angry, slightly frowning', undefined, normal),
          ]);
          return { normal, happy, surprised, angry, shy: happy };
        }

        const surprised = await generateProtagonistSprite('surprised, jaw drop, shock', undefined, normal);
        return { normal, happy: normal, surprised, angry: surprised, shy: normal };
      })();

      const heroinePromise: Promise<CharacterImages> = (async () => {
        if (mountedRef.current) setLoadingStatus(`正在生成女主立绘（${targetHeroine}）`);

        if (heroinePhoto) {
          if (maxMode) {
            const [normal, happy, shy, surprised, angry, sad] = await Promise.all([
              generateHeroineSprite('gentle smile', undefined, heroinePhoto, heroineMimeType),
              generateHeroineSprite('laughing happily', undefined, heroinePhoto, heroineMimeType),
              generateHeroineSprite('blushing shy', undefined, heroinePhoto, heroineMimeType),
              generateHeroineSprite('surprised, wide eyes, slight gasp', undefined, heroinePhoto, heroineMimeType),
              generateHeroineSprite('pouting, angry, cheeks slightly puffed', undefined, heroinePhoto, heroineMimeType),
              generateHeroineSprite('sad, watery eyes, holding back tears', undefined, heroinePhoto, heroineMimeType),
            ]);
            return { normal, happy, shy, surprised, angry, sad };
          }

          const [normal, happy, shy] = await Promise.all([
            generateHeroineSprite('gentle smile', undefined, heroinePhoto, heroineMimeType),
            generateHeroineSprite('laughing happily', undefined, heroinePhoto, heroineMimeType),
            generateHeroineSprite('blushing shy', undefined, heroinePhoto, heroineMimeType),
          ]);
          return { normal, happy, shy, surprised: normal, angry: normal };
        }

        const normal = await generateHeroineSprite('gentle smile');
        if (mountedRef.current) setLoadingStatus('正在生成女主其他表情');

        if (maxMode) {
          const [happy, shy, surprised, angry, sad] = await Promise.all([
            generateHeroineSprite('laughing happily', normal, undefined),
            generateHeroineSprite('blushing shy', normal, undefined),
            generateHeroineSprite('surprised, wide eyes, slight gasp', normal, undefined),
            generateHeroineSprite('pouting, angry, cheeks slightly puffed', normal, undefined),
            generateHeroineSprite('sad, watery eyes, holding back tears', normal, undefined),
          ]);
          return { normal, happy, shy, surprised, angry, sad };
        }

        const [happy, shy] = await Promise.all([
          generateHeroineSprite('laughing happily', normal, undefined),
          generateHeroineSprite('blushing shy', normal, undefined),
        ]);
        return { normal, happy, shy, surprised: normal, angry: normal };
      })();

      const script = await scriptPromise;
      try {
        const coins = await walletBalance();
        onCoinsUpdated?.(coins);
      } catch {}

      // 3) Wait sprites, then cutout (dedupe), while backgrounds are still generating
      const [protagonistAssetsRaw, heroineAssetsRaw] = await Promise.all([protagonistPromise, heroinePromise]);

      if (mountedRef.current) setLoadingStatus('正在处理立绘透明背景');
      const stripAssets = async <T extends Record<string, any>>(assetsObj: T): Promise<T> => {
        const entries = Object.entries(assetsObj).filter(([, v]) => typeof v === 'string' && v.trim().length > 0) as Array<[string, string]>;
        const unique = Array.from(new Set(entries.map(([, v]) => v)));
        const cleanedPairs = await Promise.all(unique.map(async (img) => [img, await removeBackground(img)] as const));
        const map = new Map(cleanedPairs);
        const out: Record<string, any> = { ...assetsObj };
        entries.forEach(([k, v]) => {
          out[k] = map.get(v) || v;
        });
        return out as T;
      };

      const [protagonistAssets, heroineAssets, backgrounds] = await Promise.all([
        stripAssets(protagonistAssetsRaw),
        stripAssets(heroineAssetsRaw),
        backgroundsPromise,
      ]);

      // 5. Audio (BGM)
      if (mountedRef.current) setLoadingStatus('正在加载背景音乐');
      const musicData: Record<string, string> = {};

      // 5.1 Fetch BGM
      if (mountedRef.current) setLoadingStatus('正在读取背景音乐文件');
      await Promise.all(
        Object.entries(AUDIO_LIBRARY).map(async ([key, url]) => {
          try {
            const audioBase64 = await fetchAudioToBase64(url);
            if (audioBase64) musicData[key] = audioBase64;
          } catch (e) {
            console.warn(`Failed to load music: ${key}`);
          }
        })
      );

      const finalUserProfile: UserProfile = {
          name: userName,
          avatarBase64: protagonistPhoto || String(protagonistAssets.normal || '') 
      };

      const finalAssets: GeneratedAssets = {
        protagonist: protagonistAssets,
        heroine: heroineAssets,
        backgrounds,
        music: musicData
      };

      if (mountedRef.current) setLoadingStatus('正在保存存档');
      try {
        await saveGame(script, finalAssets, finalUserProfile, script.startNodeId, 50);
      } catch (saveError) {
        console.warn("Auto-save failed:", saveError);
      }

      onGameReady(script, finalAssets, finalUserProfile);

    } catch (error) {
      console.error(error);
      const rawMessage = (error as Error)?.message || '生成失败，请稍后重试';
      if (rawMessage.includes('请先阅读并同意免责声明')) {
        try {
          const status = await policyStatus();
          setPolicyVersion(status.policyVersion);
        } catch {
          setPolicyVersion(1);
        }
        if (mountedRef.current) {
          setShowPolicyModal(true);
          setStep('upload');
          setErrorMessage('');
        }
        return;
      }
      const insufficientCoins = rawMessage.includes('INSUFFICIENT_COINS') || rawMessage.includes('嘎拉币不足');
      if (insufficientCoins) onNeedCoins?.();
      const message = insufficientCoins ? '嘎拉币不足，请先购买' : rawMessage;
      if (mountedRef.current) {
        setLoadingStatus('错误：' + message);
        setErrorMessage(message);
        setStep('upload');
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[12000] bg-[#f7f7f8] text-gray-900">
      <PolicyModal
        open={showPolicyModal}
        version={policyVersion}
        onDecline={() => {
          setShowPolicyModal(false);
          onCancel();
        }}
        onAccepted={async (version) => {
          await policyAccept({ version });
          setPolicyAccepted(true);
          setShowPolicyModal(false);
          setTimeout(() => {
            handleStart();
          }, 0);
        }}
      />
      <OnboardingTour
        open={showTour}
        steps={tourSteps}
        stepIndex={tourStepIndex}
        onStepIndex={setTourStepIndex}
        onClose={(markSeen) => {
          setShowTour(false);
          if (markSeen) {
            try {
              window.localStorage.setItem(TOUR_SEEN_KEY, '1');
            } catch {}
          }
        }}
      />
      <div className="w-full h-full flex flex-col relative overflow-hidden bg-white">
        
        {/* Header Bar */}
        <div className="h-14 md:h-16 border-b border-black/10 flex items-center justify-between px-4 md:px-8 bg-white shrink-0">
            <h2 className="text-base md:text-lg font-semibold tracking-tight text-gray-900">创建新嘎拉</h2>
            <div className="text-[10px] md:text-xs font-mono-tech text-gray-400">CREATE</div>
        </div>

        {step === 'upload' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-28 md:p-16 md:pb-16"
              style={
                {
                  WebkitOverflowScrolling: 'touch',
                  touchAction: 'pan-y',
                } as React.CSSProperties
              }
            >
              {errorMessage && (
                <div className="mb-5 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl flex items-start gap-3">
                  <div className="font-mono-tech text-[11px] uppercase">错误</div>
                  <div className="flex-1 text-sm leading-snug">
                    生成失败：{errorMessage}
                  </div>
                  <button
                    onClick={() => setErrorMessage('')}
                    className="text-[10px] font-bold uppercase tracking-wide text-red-600 hover:text-red-800"
                  >
                    关闭
                  </button>
                </div>
              )}

                {/* Top Section: Narrative Prompt */}
                <div className="mb-8 md:mb-12 stagger-enter">
                  <div className="flex items-baseline gap-2 mb-4 border-b border-black pb-2">
                    <span className="font-mono-tech text-xs text-black bg-gray-200 px-1">01</span>
                    <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">场景设定</h3>
                  </div>

                <div className="relative group">
                  <textarea
                    ref={plotRef}
                    value={plotDescription}
                    onChange={(e) => setPlotDescription(e.target.value)}
                    className="w-full bg-transparent border-b-2 border-gray-200 py-3 text-lg md:text-2xl font-medium h-32 md:h-28 resize-none focus:outline-none focus:border-black transition-colors rounded-none placeholder:text-gray-200 leading-relaxed font-mono-tech"
                    placeholder="例如：在屋顶一起吃午饭..."
                  />
                </div>
                </div>

                {/* Mobile-first stacked layout, desktop keeps 2 columns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16">
              
              {/* Left Column: Protagonist */}
              <div className="space-y-6 stagger-enter stagger-1">
                  <div className="flex items-baseline gap-2 mb-2 border-b border-black pb-2">
                    <span className="font-mono-tech text-xs text-black bg-gray-200 px-1">02</span>
                    <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">主角</h3>
                  </div>
                  
                  <div className="group relative">
                    <label className="block text-[9px] font-mono-tech text-gray-400 mb-1 uppercase tracking-wider">名字</label>
                    <input 
                      ref={protagonistNameRef}
                      type="text" 
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl md:text-2xl font-bold focus:outline-none focus:border-black transition-colors rounded-none placeholder:text-gray-200"
                      placeholder="请输入名字"
                    />
                  </div>

                  <div>
                    <label className="block text-[9px] font-mono-tech text-gray-400 mb-2 uppercase tracking-wider">照片 (可选)</label>
                    <div
                      ref={protagonistUploadRef}
                      className="border border-dashed border-gray-300 hover:border-black transition-all cursor-pointer relative h-32 flex items-center justify-center bg-gray-50 hover:bg-white group"
                    >
                      <input type="file" accept="image/*" onChange={handleProtagonistUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                      {protagonistPhoto ? (
                        <img src={`data:${protagonistMimeType};base64,${protagonistPhoto}`} className="h-full object-contain mix-blend-multiply" alt="预览" />
                      ) : (
                        <div className="text-center group-hover:scale-105 transition-transform">
                          <div className="text-xs font-bold text-gray-900 uppercase tracking-widest border border-black px-2 py-1 inline-block">上传图片</div>
                        </div>
                      )}
                    </div>
                  </div>
              </div>

              {/* Right Column: Heroine */}
              <div className="space-y-6 stagger-enter stagger-2">
                  <div className="flex items-baseline gap-2 mb-2 border-b border-black pb-2">
                    <span className="font-mono-tech text-xs text-black bg-gray-200 px-1">03</span>
                    <h3 className="text-xl md:text-2xl font-black uppercase tracking-tight">女主角</h3>
                  </div>

                   <div className="group relative">
                     <label className="block text-[9px] font-mono-tech text-gray-400 mb-1 uppercase tracking-wider">名字</label>
                     <input 
                       ref={heroineNameRef}
                       type="text" 
                       value={heroineName}
                       onChange={(e) => setHeroineName(e.target.value)}
                       className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl md:text-2xl font-bold focus:outline-none focus:border-black transition-colors rounded-none placeholder:text-gray-200"
                       placeholder="Unit-01 (默认)"
                     />
                   </div>

                   <div>
                    <label className="block text-[9px] font-mono-tech text-gray-400 mb-2 uppercase tracking-wider">照片 (可选)</label>
                    <div
                      ref={heroineUploadRef}
                      className="border border-dashed border-gray-300 hover:border-black transition-all cursor-pointer relative h-32 flex items-center justify-center bg-gray-50 hover:bg-white group"
                    >
                      <input type="file" accept="image/*" onChange={handleHeroineUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                      {heroinePhoto ? (
                        <img src={`data:${heroineMimeType};base64,${heroinePhoto}`} className="h-full object-contain mix-blend-multiply" alt="预览" />
                      ) : (
                        <div className="text-center group-hover:scale-105 transition-transform">
                          <div className="text-xs font-bold text-gray-900 uppercase tracking-widest border border-black px-2 py-1 inline-block">上传图片</div>
                        </div>
                      )}
                    </div>
                  </div>
              </div>
            </div>
          </div>

          {/* Sticky action bar (mobile), normal footer on desktop */}
          <div className="shrink-0 border-t-2 border-black bg-white/95 backdrop-blur px-4 md:px-16 py-3 md:py-6 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-40">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center justify-between gap-3">
                <label
                  ref={maxModeRef}
                  className={`flex items-center gap-2 select-none cursor-pointer border px-3 py-2 transition-all duration-200 group ${
                    maxMode ? 'border-black bg-black text-white' : 'border-black/20 bg-transparent text-black'
                  }`}
                  title={maxMode ? 'MAX模式：2 嘎拉币，立绘更多更精细' : '普通模式：1 嘎拉币'}
                >
                  <input
                    type="checkbox"
                    checked={maxMode}
                    onChange={(e) => setMaxMode(e.target.checked)}
                    className="h-4 w-4 accent-black"
                  />
                  <span className="text-xs font-bold tracking-widest uppercase">MAX 模式</span>
                  <span className={`ml-1 text-[10px] font-mono-tech opacity-90 whitespace-nowrap border-l pl-2 ${maxMode ? 'border-white/30' : 'border-black/20'}`}>
                    {maxMode ? '-2 币' : '-1 币'}
                  </span>
                </label>
                <div className="hidden md:block text-xs text-gray-500 font-mono-tech">
                  生成需等待，请勿关闭页面
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 md:gap-6">
                <button
                  onClick={onCancel}
                  className="text-gray-400 hover:text-black font-bold uppercase tracking-widest text-xs md:text-sm transition-colors border-b border-transparent hover:border-black"
                >
                  取消
                </button>
                <div ref={startButtonWrapRef} className="flex items-center gap-2 flex-1 md:flex-none">
                  <Button
                    onClick={handleStart}
                    disabled={!userName}
                    className={`w-full md:w-56 transition-transform ${userName ? 'active:scale-[0.98]' : ''}`}
                  >
                    {!userName ? '请先填写主角名字' : maxMode ? '开始生成 (2 嘎拉币)' : '开始生成 (1 嘎拉币)'}
                  </Button>
                </div>
              </div>
            </div>
            
            <div className="md:hidden mt-2 flex justify-between items-center border-t border-gray-100 pt-2">
                <div className="text-[9px] font-mono-tech text-gray-400">
                    模式: {maxMode ? 'MAX' : '标准'}
                </div>
                <div className="text-[9px] font-mono-tech text-gray-300 uppercase">
                    安全协议已激活
                </div>
            </div>
          </div>
          </div>
        )}

        {step === 'generating' && (
          <div className="fixed inset-0 z-[24000] bg-[#f7f7f8] text-gray-900 flex items-center justify-center p-6 overlay-fade-in">
            <div className="w-full max-w-md bg-white border border-black/10 rounded-3xl shadow-[0_30px_80px_rgba(0,0,0,0.12)] p-6 modal-scale-in">
              <div className="flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-2 border-black/10 border-t-black animate-spin" />
              </div>
              <div className="mt-5 text-base font-semibold text-center text-gray-900">
                {loadingStatus || '生成中…'}
              </div>
              <div className="mt-2 text-xs text-center text-gray-500 font-mono-tech">
                预计需要几分钟，请保持页面打开
              </div>
              <div className="mt-5 h-1 w-full bg-black/5 overflow-hidden rounded-full">
                <div className="h-full w-1/2 bg-black/70 animate-pulse" />
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default GameCreationWizard;
