'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AccountUser,
  GameGenerationJobStatus,
  GameGenerationResult,
  GameState,
  GameScript,
  GeneratedAssets,
  SaveFile,
  UserProfile,
} from './types';
import BuyCoinsModal from './components/BuyCoinsModal';
import GalaPlazaModal from './components/GalaPlazaModal';
import GameCreationWizard from './components/GameCreationWizard';
import VisualNovelPlayer from './components/VisualNovelPlayer';
import LoginScreen from './components/LoginScreen';
import Button from './components/Button';
import CopyLinkModal from './components/CopyLinkModal';
import SupportModal from './components/SupportModal';
import { deleteSaveServer } from './services/saveService';
import { authLogout, authMe } from './services/accountService';
import { publishPlazaGame } from './services/plazaService';
import { getGameGenerationJob, getGameGenerationJobWithProgress, type TransferProgress } from './services/aiService';
import { stripAssetBase64Map, warmUpBackgroundRemoval } from './services/imageCutout';
import { listGenerationJobs, retryGenerationJob, type GenerationJobSummary } from './services/generationJobService';
import { deleteSave, getSaveList, saveGame } from './services/storageService';

const toDataUrl = (base64: string) => {
  const trimmed = typeof base64 === 'string' ? base64.trim() : '';
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('/9j')) return `data:image/jpeg;base64,${trimmed}`;
  if (trimmed.startsWith('iVBORw0')) return `data:image/png;base64,${trimmed}`;
  return `data:image/png;base64,${trimmed}`;
};

const loadImage = (src: string, timeoutMs = 12_000) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => {
      reject(new Error('image load timeout'));
    }, timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('image load failed'));
    };
    const dataUrl = toDataUrl(src);
    if (!dataUrl) {
      window.clearTimeout(timer);
      reject(new Error('empty image data'));
      return;
    }
    img.src = dataUrl;
  });

const pickHeroineSprite = (assets: GeneratedAssets) =>
  assets.heroine?.shy || assets.heroine?.happy || assets.heroine?.normal;

const pickProtagonistSprite = (assets: GeneratedAssets) =>
  assets.protagonist?.happy || assets.protagonist?.normal;

const composeSaveCover = async (assets: GeneratedAssets): Promise<string | null> => {
  const bgRaw = Object.values(assets.backgrounds || {})[0];
  const heroRaw = pickHeroineSprite(assets);
  const protagRaw = pickProtagonistSprite(assets);
  if (!bgRaw || !heroRaw) return null;

  try {
    const bgImg = await loadImage(bgRaw);
    const heroImg = await loadImage(heroRaw);
    const protagImg = protagRaw ? await loadImage(protagRaw) : null;

    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const scale = Math.max(canvas.width / bgImg.width, canvas.height / bgImg.height);
    const bgW = bgImg.width * scale;
    const bgH = bgImg.height * scale;
    ctx.drawImage(bgImg, (canvas.width - bgW) / 2, (canvas.height - bgH) / 2, bgW, bgH);

    const safeX = canvas.width * 0.08;
    if (protagImg) {
      const pHeight = canvas.height * 0.92;
      const pScale = pHeight / protagImg.height;
      const pWidth = protagImg.width * pScale;
      ctx.drawImage(protagImg, safeX, canvas.height - pHeight, pWidth, pHeight);

      const hHeight = canvas.height * 0.96;
      const hScale = hHeight / heroImg.height;
      const hWidth = heroImg.width * hScale;
      ctx.drawImage(heroImg, canvas.width - hWidth - safeX, canvas.height - hHeight, hWidth, hHeight);
    } else {
      const hHeight = canvas.height * 0.96;
      const hScale = hHeight / heroImg.height;
      const hWidth = heroImg.width * hScale;
      ctx.drawImage(heroImg, (canvas.width - hWidth) / 2, canvas.height - hHeight, hWidth, hHeight);
    }

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('Save cover compose failed', e);
    return null;
  }
};

const App: React.FC = () => {
  const PENDING_JOB_KEY = 'renyuki:pending-generation-job';
  const [gameState, setGameState] = useState<GameState>(GameState.HOME);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [showBuyCoins, setShowBuyCoins] = useState(false);
  const [showPlaza, setShowPlaza] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [publishingSaveId, setPublishingSaveId] = useState<number | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishLink, setPublishLink] = useState<string | null>(null);
  const publishTimerRef = useRef<number | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  
  const [currentScript, setCurrentScript] = useState<GameScript | null>(null);
  const [currentAssets, setCurrentAssets] = useState<GeneratedAssets | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [saveList, setSaveList] = useState<SaveFile[]>([]);
  const [saveCoverMap, setSaveCoverMap] = useState<Record<number, string>>({});
  const saveCoverMapRef = useRef<Record<number, string>>({});
  const [generationJobs, setGenerationJobs] = useState<GenerationJobSummary[]>([]);
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [jobActionMessage, setJobActionMessage] = useState<string | null>(null);
  const [initialNodeId, setInitialNodeId] = useState<string | undefined>(undefined);
  const [initialAffinity, setInitialAffinity] = useState<number | undefined>(undefined);

  const [galleryHeroines, setGalleryHeroines] = useState<{name: string, image: string, id: number}[]>([]);
  const [pendingGenerationJobId, setPendingGenerationJobId] = useState<string | null>(null);
  const [pendingGenerationStatus, setPendingGenerationStatus] = useState<GameGenerationJobStatus | null>(null);
  const [pendingGenerationError, setPendingGenerationError] = useState<string | null>(null);
  const [clientPostProcessing, setClientPostProcessing] = useState(false);
  const [postProcessProgress, setPostProcessProgress] = useState<{ done: number; total: number } | null>(null);
  const [resultDownloadProgress, setResultDownloadProgress] = useState<TransferProgress | null>(null);
  const [lastFailedJob, setLastFailedJob] = useState<GenerationJobSummary | null>(null);
  const pollInFlightRef = useRef(false);
  const modnetWarmupRef = useRef(false);
  const coins = accountUser?.coins ?? 0;
  const forceLandscapeOnMobile =
    gameState === GameState.PLAYING && isTouchDevice && isPortrait;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await authMe();
        if (cancelled) return;
        setAccountUser(user);
        setIsLoggedIn(true);
      } catch {
        if (cancelled) return;
        setAccountUser(null);
        setIsLoggedIn(false);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authChecked || !isLoggedIn) return;
    try {
        const jobId = window.localStorage.getItem(PENDING_JOB_KEY);
        if (jobId && typeof jobId === 'string' && jobId.trim().length > 0) {
          setPendingGenerationJobId(jobId);
          setPendingGenerationError(null);
          setClientPostProcessing(false);
          setShowLoadMenu(true);
          void (async () => {
            try {
              const [saves, jobs] = await Promise.all([getSaveList(), listGenerationJobs()]);
              setSaveList(saves);
              setGenerationJobs(jobs);
            } catch {}
          })();
        }
    } catch {}
  }, [authChecked, isLoggedIn]);

  useEffect(() => {
    if (!publishMessage) return;
    if (publishTimerRef.current) window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = window.setTimeout(() => setPublishMessage(null), 2600);
    return () => {
      if (publishTimerRef.current) window.clearTimeout(publishTimerRef.current);
      publishTimerRef.current = null;
    };
  }, [publishMessage]);

  useEffect(() => {
    // 1. Touch Detection (use pointer capability, not viewport ratio)
    const touchCapable = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(touchCapable);

    // 2. Fullscreen Listener
    const handleFsChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    
    const UA = navigator.userAgent || '';
    const IS_IOS =
      /iPad|iPhone|iPod/.test(UA) ||
      (UA.includes('Mac') && (navigator as any).maxTouchPoints > 2 && 'ontouchend' in document);
    const IS_STANDALONE_MODE =
      window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(!!IS_STANDALONE_MODE);

    // 4. Orientation Listener
    const checkOrientation = () => {
       // Use matchMedia for reliability or innerHeight/Width fallback
       const isPort = window.matchMedia("(orientation: portrait)").matches || window.innerHeight > window.innerWidth;
       setIsPortrait(isPort);
    };
    
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange);
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  useEffect(() => {
    const loadGallery = async () => {
      if (!isLoggedIn) {
        setGalleryHeroines([]);
        return;
      }
      try {
        const saves = await getSaveList();
        // Modification: Only show the SINGLE most recent heroine
        if (saves.length > 0) {
            const latest = saves[0]; // getSaveList returns sorted by newest first
            setGalleryHeroines([{
               name: latest.heroineName,
               image: latest.assets.heroine.normal,
               id: latest.id
            }]);
        } else {
            setGalleryHeroines([]);
        }
      } catch (e) { console.error(e); }
    };
    loadGallery();
  }, [gameState, isLoggedIn]);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn("Error enabling full-screen mode:", err.message);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleLoggedIn = (user: AccountUser) => {
    setAccountUser(user);
    setIsLoggedIn(true);
    setAuthChecked(true);
  };

  const proceedToGame = (
    script: GameScript, 
    assets: GeneratedAssets, 
    user: UserProfile,
    startNodeId?: string,
    startAffinity?: number
  ) => {
    setCurrentScript(script);
    setCurrentAssets(assets);
    setCurrentUser(user);
    setInitialNodeId(startNodeId);
    setInitialAffinity(startAffinity);
    setGameState(GameState.PLAYING);
  };

  const startCreation = () => {
    if (!accountUser) {
      setShowPlaza(false);
      setShowLoadMenu(false);
      setShowBuyCoins(false);
      setIsLoggedIn(false);
      setAuthChecked(true);
      return;
    }
    setGameState(GameState.CREATING);
  };

  const TouchHomeMenu = () => (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden relative">
      {/* TOP SECTION: VISUAL (62%) */}
      <div className="relative h-[62%] w-full bg-gray-100 z-10">
        <div className="absolute inset-0 z-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 overflow-hidden"></div>
        
        {/* Diagonal Cut Overlay */}
        <div className="absolute bottom-0 left-0 w-full h-16 bg-white transform -skew-y-3 origin-bottom-left z-20 scale-110 translate-y-8"></div>

        <div className="absolute inset-0 flex items-end justify-center z-10">
          {galleryHeroines.length > 0 ? (
            <div className="relative w-full h-full animate-fade-in">
              {galleryHeroines.map((h) => (
                <div
                  key={h.id}
                  className="absolute bottom-0 left-1/4 -translate-x-1/4 translate-y-[40%] filter contrast-110 scale-[1.7] origin-bottom"
                  style={{ width: 'auto', height: '100%' }}
                >
                  <img
                    src={`data:image/png;base64,${h.image}`}
                    className="h-full w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.2)]"
                    alt={h.name}
                  />
                </div>
              ))}
            </div>
          ) : (
             <div className="w-full h-full flex items-center justify-center">
                <div className="text-4xl font-black text-gray-200 -rotate-90 tracking-widest opacity-30">无数据</div>
             </div>
          )}
        </div>
      </div>

      {/* BOTTOM SECTION: CONTROLS (38%) */}
      <div className="flex-1 bg-white relative z-30 px-6 pt-2 pb-2 flex flex-col justify-end gap-6 shadow-[0_-20px_50px_rgba(255,255,255,1)]">
        {/* Header */}
        <div className="stagger-enter stagger-1 relative z-40">
          <h1 className="text-5xl font-black tracking-tighter leading-[0.8] mb-1">RenYuki</h1>
          <div className="flex items-center gap-3">
             <span className="text-xs font-mono-tech text-gray-400 tracking-widest uppercase">制作你的Galgame</span>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex flex-col gap-3">
          <button
            onClick={startCreation}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-2 touch-active"
          >
            <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">创建新嘎拉</span>
            <span className="font-mono-tech text-xs text-gray-400">01 // 创建</span>
          </button>

          <button
            onClick={openLoadMenu}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-3 touch-active"
          >
            <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">游戏存档</span>
            <span className="font-mono-tech text-xs text-gray-400">02 // 读取</span>
          </button>

          <button
            onClick={() => setShowPlaza(true)}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-4 touch-active"
          >
             <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">嘎拉广场</span>
             <span className="font-mono-tech text-xs text-gray-400">03 // 广场</span>
          </button>

          <button
            onClick={() => setShowSupportModal(true)}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-5 touch-active"
          >
             <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">遇到问题 / 有好的想法</span>
             <span className="font-mono-tech text-xs text-gray-400">04 // 反馈</span>
          </button>
        </div>

        {/* Footer */}
        <div className="stagger-enter stagger-6">
          <div className="text-[9px] text-gray-400/60 leading-relaxed max-w-xs mx-auto text-center select-none">
            本站为 AI 剧情生成演示与娱乐用途。请勿上传违法、侵权或不当内容；由用户输入/上传产生的后果由用户自行承担。
          </div>
        </div>
      </div>
    </div>
  );

  const handleLogout = async () => {
    try {
      await authLogout();
    } catch {}
    setAccountUser(null);
    setIsLoggedIn(false);
    setAuthChecked(true);
    setShowLoadMenu(false);
    try {
      window.localStorage.removeItem(PENDING_JOB_KEY);
    } catch {}
    setPendingGenerationJobId(null);
    setPendingGenerationStatus(null);
    setPendingGenerationError(null);
    setClientPostProcessing(false);
    setGenerationJobs([]);
    resetGame();
  };

  const resetGame = () => {
    if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    setGameState(GameState.HOME);
    setCurrentScript(null);
    setCurrentAssets(null);
    setCurrentUser(null);
  };

  const handlePublishSaveToPlaza = async (save: SaveFile, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (publishingSaveId) return;
    setPublishingSaveId(save.id);
    setPublishMessage(null);
    try {
      const game = await publishPlazaGame(save);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = origin ? `${origin}/g/${game.id}` : `/g/${game.id}`;
      setPublishMessage('已发布');
      setPublishLink(url);
      setShowPlaza(true);
      setShowLoadMenu(false);
    } catch (err: any) {
      setPublishMessage(err?.message || '发布失败');
    } finally {
      setPublishingSaveId(null);
    }
  };

  const refreshMemory = async () => {
    const [saves, jobs] = await Promise.all([getSaveList(), listGenerationJobs()]);
    setSaveList(saves);
    setGenerationJobs(jobs);
  };

  useEffect(() => {
    saveCoverMapRef.current = saveCoverMap;
  }, [saveCoverMap]);

  useEffect(() => {
    let canceled = false;
    const ids = new Set(saveList.map((save) => save.id));

    setSaveCoverMap((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([id, cover]) => {
        const numId = Number(id);
        if (ids.has(numId)) next[numId] = cover;
      });
      return next;
    });

    const run = async () => {
      for (const save of saveList) {
        if (canceled) return;
        if (saveCoverMapRef.current[save.id]) continue;
        const cover = await composeSaveCover(save.assets);
        if (canceled) return;
        if (cover) {
          setSaveCoverMap((prev) => ({ ...prev, [save.id]: cover }));
        }
      }
    };

    if (saveList.length > 0) {
      void run();
    }

    return () => {
      canceled = true;
    };
  }, [saveList]);

  const openLoadMenu = async () => {
    setShowLoadMenu(true);
    try {
      await refreshMemory();
    } catch (e) { console.error(e); }
  };

  const handleGenerationStarted = async (jobId: string) => {
    setPendingGenerationJobId(jobId);
    setPendingGenerationStatus(null);
    setPendingGenerationError(null);
    setClientPostProcessing(false);
    setPostProcessProgress(null);
    if (!modnetWarmupRef.current) {
      modnetWarmupRef.current = true;
      void warmUpBackgroundRemoval();
    }
    try {
      window.localStorage.setItem(PENDING_JOB_KEY, jobId);
    } catch {}
    setShowPlaza(false);
    setShowBuyCoins(false);
    setGameState(GameState.HOME);
    await openLoadMenu();
  };

  const finalizeAndStartGame = async (payload: GameGenerationResult, saveId?: number) => {
    setClientPostProcessing(true);
    const countUniqueImages = (obj: Record<string, any>) =>
      new Set(
        Object.values(obj || {}).filter((v) => typeof v === 'string' && v.trim().length > 0) as string[]
      ).size;
    const totalImages = countUniqueImages(payload.assets.protagonist || {}) + countUniqueImages(payload.assets.heroine || {});
    if (totalImages > 0) {
      setPostProcessProgress({ done: 0, total: totalImages });
    } else {
      setPostProcessProgress(null);
    }
    setPendingGenerationStatus((prev) =>
      prev
        ? { ...prev, progress: Math.max(prev.progress, 95), message: '正在处理立绘透明背景（本地）' }
        : prev
    );

    await warmUpBackgroundRemoval();

    let processed = 0;
    const bumpProgress = () => {
      if (totalImages <= 0) return;
      processed += 1;
      setPostProcessProgress({ done: processed, total: totalImages });
      const pct = 95 + Math.round((processed / totalImages) * 5);
      setPendingGenerationStatus((prev) =>
        prev ? { ...prev, progress: Math.max(prev.progress, pct), message: `正在处理立绘透明背景（${processed}/${totalImages}）` } : prev
      );
    };

    const protagonist = await stripAssetBase64Map(payload.assets.protagonist, bumpProgress);
    const heroine = await stripAssetBase64Map(payload.assets.heroine, bumpProgress);

    const finalAssets: GeneratedAssets = {
      ...payload.assets,
      protagonist,
      heroine,
      music: payload.assets.music || {},
      voice: payload.assets.voice || {},
    };

    try {
      await saveGame(payload.script, finalAssets, payload.userProfile, payload.initialNodeId, payload.initialAffinity);
      await refreshMemory();
    } catch {
      // keep server save if local persistence fails
    }

    if (saveId) {
      try {
        await deleteSaveServer(saveId);
      } catch {}
    }

    setShowLoadMenu(false);
    setPostProcessProgress(null);
    proceedToGame(payload.script, finalAssets, payload.userProfile, payload.initialNodeId, payload.initialAffinity);
  };

  useEffect(() => {
    if (!authChecked || !isLoggedIn) return;
    if (!pendingGenerationJobId) return;

    let cancelled = false;

    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const status = await getGameGenerationJob(pendingGenerationJobId);
        if (cancelled) return;
        setPendingGenerationStatus(status);
        setPendingGenerationError(status.jobError || null);

        if (status.state === 'failed') {
          setLastFailedJob({
            id: pendingGenerationJobId,
            status: 'failed',
            message: status.message || '生成失败',
            error: status.jobError,
            coinCost: 0,
            createdAt: status.createdAt || new Date().toISOString(),
            updatedAt: status.updatedAt || new Date().toISOString(),
            progress: 100,
          });
          try {
            window.localStorage.removeItem(PENDING_JOB_KEY);
          } catch {}
          setPendingGenerationJobId(null);
          setClientPostProcessing(false);
          setPostProcessProgress(null);
          setResultDownloadProgress(null);
          try {
            await refreshMemory();
          } catch {}
          return;
        }

        if (status.state === 'completed') {
          setResultDownloadProgress({ loaded: 0, total: null, percent: 0 });
          const full = await getGameGenerationJobWithProgress(
            pendingGenerationJobId,
            { includeResult: true, includeDebug: true },
            (p) => {
              if (cancelled) return;
              setResultDownloadProgress(p);
            }
          );
          setResultDownloadProgress(null);
          if (cancelled) return;
          const result = full.result;
          if (!result) {
            setPendingGenerationError('生成完成，但未拿到结果，请刷新重试');
            return;
          }
          setPendingGenerationStatus(full);
          try {
            window.localStorage.removeItem(PENDING_JOB_KEY);
          } catch {}
          setPendingGenerationJobId(null);
          setPostProcessProgress(null);
          await finalizeAndStartGame(result, full.resultSaveId);
          try {
            await refreshMemory();
          } catch {}
          return;
        }

        if (!modnetWarmupRef.current) {
          modnetWarmupRef.current = true;
          void warmUpBackgroundRemoval();
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.message || '生成状态查询失败';
        setPendingGenerationError(msg);
        if (msg.includes('任务不存在或已过期')) {
          try {
            window.localStorage.removeItem(PENDING_JOB_KEY);
          } catch {}
          setPendingGenerationJobId(null);
          setClientPostProcessing(false);
          setPostProcessProgress(null);
          try {
            await refreshMemory();
          } catch {}
        }
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(poll, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authChecked, isLoggedIn, pendingGenerationJobId]);

  const loadSaveFile = (save: SaveFile) => {
    setShowLoadMenu(false);
    proceedToGame(save.script, save.assets, save.userProfile, save.currentNodeId, save.affinity);
  };

  const handleDeleteSave = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('确定要删除这个存档吗？删除后将无法恢复。')) return;
    try {
      await deleteSave(id);
      setSaveList(prev => prev.filter(s => s.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleRetryJob = async (id: string) => {
    if (jobActionId) return;
    setJobActionId(id);
    setJobActionMessage(null);
    try {
      const { jobId } = await retryGenerationJob(id);
      setJobActionMessage('已开始重试');
      await handleGenerationStarted(jobId);
    } catch (err: any) {
      const msg = err?.message || '重试失败';
      setJobActionMessage(msg);
      if (msg.includes('INSUFFICIENT_COINS') || msg.includes('嘎拉币不足')) {
        setShowBuyCoins(true);
      }
    } finally {
      setJobActionId(null);
      window.setTimeout(() => setJobActionMessage(null), 2400);
    }
  };

  if (!authChecked) {
    return (
      <div className="w-screen h-screen bg-[#f7f7f8] text-gray-600 flex items-center justify-center">
        <div className="text-sm font-mono-tech">Loading…</div>
      </div>
    );
  }

  if (!isLoggedIn) return (
    <>
      <LoginScreen
        onLoggedIn={handleLoggedIn}
        onEnterPlazaAsGuest={() => {
          setAuthChecked(true);
          setIsLoggedIn(true);
          setAccountUser(null);
          setShowPlaza(true);
        }}
      />
    </>
  );

  return (
    <div className="w-screen h-screen bg-[#f3f3f3] text-[#111] relative overflow-hidden flex font-sans">
      
      <BuyCoinsModal
        open={showBuyCoins}
        coins={coins}
        onClose={() => setShowBuyCoins(false)}
        onCoinsUpdated={(newCoins) =>
          setAccountUser((prev) => (prev ? { ...prev, coins: newCoins } : prev))
        }
      />
      <GalaPlazaModal
        open={showPlaza}
        onClose={() => setShowPlaza(false)}
        onPlaySave={(save) => {
          setShowPlaza(false);
          proceedToGame(save.script, save.assets, save.userProfile, save.currentNodeId, save.affinity);
        }}
        isAdmin={accountUser?.username === 'admire'}
        hasAccountUser={!!accountUser}
      />
      <CopyLinkModal
        open={!!publishLink}
        url={publishLink || ''}
        title="已发布：复制分享链接"
        onClose={() => setPublishLink(null)}
      />
      <SupportModal
        open={showSupportModal}
        onClose={() => setShowSupportModal(false)}
      />

      {accountUser && gameState === GameState.HOME && !showLoadMenu && !showPlaza && !showBuyCoins && (
        <div className="fixed top-3 right-3 z-[14000] pointer-events-auto">
          <div className="bg-white/80 backdrop-blur border border-black/10 rounded-2xl shadow-lg px-3 py-2 flex items-center gap-3">
            <div className="flex flex-col leading-tight">
              <div className="text-[11px] text-gray-500">账号</div>
              <div className="text-sm font-semibold text-gray-900 max-w-[12rem] truncate">
                {accountUser.displayName || accountUser.username}
              </div>
            </div>
            <div className="h-8 w-px bg-gray-200" />
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-700">
                嘎拉币 <span className="font-semibold text-gray-900">{coins}</span>
              </div>
              <button
                onClick={() => setShowBuyCoins(true)}
                className="rounded-xl bg-gray-900 text-white text-xs font-semibold px-3 py-2 hover:bg-black transition-colors"
              >
                支持作者
              </button>
              <button
                onClick={handleLogout}
                className="text-xs text-gray-500 hover:text-gray-900 transition-colors px-1"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      )}
      
      {publishMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[25000] bg-black text-white px-3 py-2 rounded-xl text-xs font-mono-tech toast-slide-in">
          {publishMessage}
        </div>
      )}

      {gameState === GameState.PLAYING && !forceLandscapeOnMobile && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto">
          <button
            onClick={toggleFullScreen}
            className="bg-black/80 backdrop-blur text-white px-4 py-1 text-[10px] font-mono-tech uppercase tracking-widest border border-gray-600 hover:bg-black transition-all rounded-b-lg shadow-lg opacity-30 hover:opacity-100"
          >
            {isFullScreen ? '退出全屏' : '进入全屏'}
          </button>
        </div>
      )}

      {/* Decorative Background Grid */}
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      </div>

      <div className="relative z-10 w-full h-full flex">
        
        {/* Main Menu State */}
        {gameState === GameState.HOME && !showLoadMenu && (
          <>
          {isTouchDevice && isPortrait ? (
            <TouchHomeMenu />
          ) : (
            <div className="w-full h-full grid grid-cols-12 soft-fade-in">
             
             {/* LEFT: Typography & Nav */}
             <div className="col-span-5 h-full flex flex-col justify-center px-4 md:px-8 lg:px-20 relative bg-white border-r border-black z-20">
                <div className="mb-8 lg:mb-20">
                    <h1 className="text-4xl md:text-5xl lg:text-8xl font-black tracking-tighter leading-[0.8]">RenYuki</h1>
                    <h2 className="text-sm md:text-base lg:text-sm font-light uppercase tracking-[0.3em] mt-2 whitespace-nowrap text-gray-400">制作你的Galgame</h2>
                    <div className="w-8 md:w-16 lg:w-20 h-1 lg:h-2 bg-black mt-4 lg:mt-6"></div>
                </div>

                <div className="space-y-4 lg:space-y-6 flex flex-col items-start">
                   <button onClick={startCreation} className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left">
                      01 // 创建新嘎拉
                   </button>
                   <button onClick={openLoadMenu} className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left">
                      02 // 游戏存档
                   </button>
                   <button
                     onClick={() => setShowPlaza(true)}
                     className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left"
                   >
                      03 // 嘎拉广场
                   </button>
                   <button
                     onClick={() => setShowSupportModal(true)}
                     className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left"
                   >
                      04 // 遇到问题 / 有好的想法
                   </button>
                </div>

                <div className="mt-10 lg:mt-14 text-[10px] lg:text-[11px] text-gray-400/60 leading-relaxed max-w-md select-none">
                  本站为 AI 剧情生成演示与娱乐用途。请勿上传违法、侵权或不当内容；由用户输入/上传产生的后果由用户自行承担。
                </div>
             </div>

             {/* RIGHT: Visuals / Gallery */}
             <div className="col-span-7 h-full relative bg-gray-100 overflow-hidden">
                {/* Slanted decorative line */}
                <div className="absolute top-0 -left-10 md:-left-20 w-20 md:w-40 h-full bg-gray-200 transform skew-x-[-10deg]"></div>
                
                {/* Heroine Showcase - Single Recent Heroine */}
                <div className="absolute inset-0 flex items-center justify-center">
                    {galleryHeroines.length > 0 ? (
                        <div className="relative w-full h-full">
                           {galleryHeroines.map((h) => (
                             <div 
                               key={h.id}
                               className="absolute bottom-0 transition-all duration-500 hover:scale-105 filter grayscale hover:grayscale-0 contrast-125"
                               style={{ 
                                   right: '10%', // Fixed position for the single hero
                                   zIndex: 10,
                                   opacity: 1
                               }}
                             >
                                {/* Increased height for better prominence of single character */}
                                <img src={`data:image/png;base64,${h.image}`} className="h-[95vh] object-contain drop-shadow-2xl" />
                                <div className="absolute top-1/2 -right-6 md:-right-10 bg-black text-white text-[10px] md:text-xs font-mono-tech px-1 md:px-2 py-2 md:py-4 writing-vertical rotate-180">
                                   编号: {h.name.toUpperCase()}
                                </div>
                             </div>
                           ))}
                        </div>
                    ) : (
                        <div className="text-2xl md:text-6xl font-black text-gray-300 opacity-50 rotate-90 origin-center tracking-widest whitespace-nowrap">
                           NO_DATA / 无数据
                        </div>
                    )}
                </div>
             </div>
          </div>
          )}
          </>
        )}

        {/* Load Menu Overlay */}
        {gameState === GameState.HOME && showLoadMenu && (
             <div className="absolute inset-0 z-50 bg-white flex flex-col soft-fade-in">
                 <div className="h-14 lg:h-20 border-b border-black flex items-center justify-between px-4 lg:px-10 bg-gray-50">
                     <h2 className="text-xl lg:text-3xl font-black uppercase">本地游戏存档</h2>
                     <div className="flex gap-2 lg:gap-4">
                        <button onClick={() => setShowLoadMenu(false)} className="text-2xl lg:text-4xl hover:rotate-90 transition-transform">×</button>
                     </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 lg:p-10 bg-gray-100">
                     <div className="flex flex-col gap-6 lg:gap-10">
                         {pendingGenerationJobId && (
                           <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-4 lg:p-6">
                             <div className="flex items-start justify-between gap-4">
                               <div className="min-w-0">
                                 <div className="text-xs font-mono-tech text-gray-500">正在生成新的嘎拉（服务器）</div>
                                 <div className="text-sm lg:text-base font-semibold text-gray-900 mt-1">
                                   {clientPostProcessing
                                     ? '正在处理立绘透明背景（本地）'
                                     : pendingGenerationStatus?.message || '排队中…'}
                                 </div>
                               </div>
                               <div className="text-xs font-mono-tech text-gray-600">
                                 {Math.max(0, Math.min(100, pendingGenerationStatus?.progress ?? 0))}%
                               </div>
                             </div>
                             <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                               <div
                                 className="h-full bg-black transition-all"
                                 style={{ width: `${Math.max(0, Math.min(100, pendingGenerationStatus?.progress ?? 0))}%` }}
                               />
                             </div>
                             {pendingGenerationError && (
                               <div className="mt-3 text-xs font-mono-tech text-red-600">生成失败：{pendingGenerationError}</div>
                             )}
                           </div>
                         )}
                         {clientPostProcessing && postProcessProgress && (
                           <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-4 lg:p-6">
                             <div className="flex items-start justify-between gap-4">
                               <div className="min-w-0">
                                 <div className="text-xs font-mono-tech text-gray-500">下载并处理资源</div>
                                 <div className="text-sm lg:text-base font-semibold text-gray-900 mt-1">
                                   正在处理立绘透明背景（{postProcessProgress.done}/{postProcessProgress.total}）
                                 </div>
                               </div>
                               <div className="text-xs font-mono-tech text-gray-600">
                                 {Math.round((postProcessProgress.done / Math.max(1, postProcessProgress.total)) * 100)}%
                               </div>
                             </div>
                             <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                               <div
                                 className="h-full bg-black transition-all"
                                 style={{
                                   width: `${Math.round((postProcessProgress.done / Math.max(1, postProcessProgress.total)) * 100)}%`,
                                 }}
                               />
                             </div>
                           </div>
                         )}
                         {resultDownloadProgress && (
                           <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-4 lg:p-6">
                             <div className="flex items-start justify-between gap-4">
                               <div className="min-w-0">
                                 <div className="text-xs font-mono-tech text-gray-500">下载生成结果</div>
                                 <div className="text-sm lg:text-base font-semibold text-gray-900 mt-1">
                                   {typeof resultDownloadProgress.percent === 'number'
                                     ? `正在下载…${resultDownloadProgress.percent}%`
                                     : `正在下载…（${Math.round(resultDownloadProgress.loaded / 1024)} KB）`}
                                 </div>
                               </div>
                               <div className="text-xs font-mono-tech text-gray-600">
                                 {typeof resultDownloadProgress.percent === 'number' ? `${resultDownloadProgress.percent}%` : '--'}
                               </div>
                             </div>
                             <div className="mt-3 h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                               <div
                                 className="h-full bg-black transition-all"
                                 style={{ width: `${Math.max(0, Math.min(100, resultDownloadProgress.percent ?? 0))}%` }}
                               />
                             </div>
                           </div>
                         )}
                         {lastFailedJob && (
                           <div className="space-y-3">
                             <div className="text-xs font-mono-tech text-gray-500">最近一条生成失败</div>
                               <div className="bg-white border border-black/10 rounded-2xl shadow-sm p-4 lg:p-5 relative">
                                 <button 
                                   onClick={() => setLastFailedJob(null)}
                                   className="absolute top-2 right-2 text-gray-400 hover:text-black p-1"
                                 >
                                   ✕
                                 </button>
                                 <div className="flex items-start justify-between gap-4 pr-6">
                                   <div className="min-w-0">
                                     <div className="text-sm font-semibold text-gray-900">
                                       {lastFailedJob.status === 'expired' ? '生成超时' : '生成失败'}
                                     </div>
                                     <div className="text-xs text-gray-500 mt-1">{lastFailedJob.message || '生成失败'}</div>
                                     {lastFailedJob.error && (
                                       <div className="text-xs text-red-600 mt-1">原因：{lastFailedJob.error}</div>
                                     )}
                                     <div className="text-[11px] font-mono-tech text-emerald-600 mt-2">已退还所有嘎拉币</div>
                                   </div>
                                   <div className="flex flex-col items-end gap-2">
                                     <button
                                       onClick={() => handleRetryJob(lastFailedJob.id)}
                                       disabled={jobActionId === lastFailedJob.id}
                                       className="bg-black text-white text-xs font-semibold px-3 py-2 rounded-xl hover:bg-gray-900 transition-colors disabled:opacity-60"
                                     >
                                       {jobActionId === lastFailedJob.id ? '处理中…' : '重试'}
                                     </button>
                                     <div className="text-[10px] font-mono-tech text-gray-400">
                                       {new Date(lastFailedJob.createdAt).toLocaleString('zh-CN')}
                                     </div>
                                   </div>
                                 </div>
                               </div>
                           </div>
                         )}
                         {jobActionMessage && (
                           <div className="text-xs font-mono-tech text-gray-500">{jobActionMessage}</div>
                         )}
                         {saveList.length === 0 ? (
                             <div className="col-span-full text-center py-20 font-mono-tech text-gray-400">暂无本地存档</div>
                         ) : (
                             saveList.map(save => (
                                 <div 
                                   key={save.id}
                                   onClick={() => loadSaveFile(save)}
                                   className="group relative bg-black cursor-pointer transition-all shadow-xl h-[calc(100vh-6rem)] w-full overflow-hidden"
                                 >
                                     <img
                                       src={saveCoverMap[save.id] || toDataUrl(save.assets.heroine?.normal || '')}
                                       className="absolute inset-0 w-full h-full object-cover"
                                       alt={save.title}
                                     />
                                     <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors" />
                                     <div className="absolute bottom-0 left-0 right-0 p-4 lg:p-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white flex flex-col gap-2">
                                        <div>
                                          <h3 className="font-bold text-lg lg:text-3xl uppercase truncate">{save.title}</h3>
                                          <p className="text-[10px] lg:text-xs text-gray-300 font-mono-tech mt-1">{save.date}</p>
                                        </div>
                                        <div className="flex items-center justify-between mt-2">
                                           <div className="flex flex-col">
                                             <span className="text-[10px] lg:text-xs font-mono-tech text-gray-400">女主角</span>
                                             <span className="font-bold text-sm lg:text-xl border-b border-white/60 inline-block">{save.heroineName}</span>
                                           </div>
                                           <div className="text-right">
                                              <span className="block text-[10px] lg:text-xs font-mono-tech text-gray-400 mb-1">同步率</span>
                                              <span className="text-xl lg:text-3xl font-black">{save.affinity}%</span>
                                           </div>
                                        </div>
                                     </div>
                                     <div className="absolute top-3 right-3 lg:top-6 lg:right-6 flex items-center gap-2 z-20">
                                       <button
                                         onClick={(e) => handlePublishSaveToPlaza(save, e)}
                                         title="发布并复制分享链接"
                                         className="bg-white text-black hover:bg-white/95 px-3 py-2 rounded-xl font-black shadow-xl border border-black/10"
                                         disabled={publishingSaveId === save.id}
                                       >
                                         {publishingSaveId === save.id ? '发布中…' : '发布到嘎拉广场并复制链接'}
                                       </button>
                                       <button
                                         onClick={(e) => handleDeleteSave(save.id, e)}
                                         title="删除存档"
                                         className="bg-red-600 text-white hover:bg-red-700 px-3 py-2 rounded-xl font-black shadow-xl border border-black/10 transition-colors"
                                       >
                                         删除存档
                                       </button>
                                     </div>
                                 </div>
                             ))
                         )}
                     </div>
                 </div>
             </div>
        )}

        {gameState === GameState.CREATING && (
          <GameCreationWizard 
            onCoinsUpdated={(newCoins) =>
              setAccountUser((prev) => (prev ? { ...prev, coins: newCoins } : prev))
            }
            onNeedCoins={() => setShowBuyCoins(true)}
            onGenerationStarted={handleGenerationStarted}
            onCancel={resetGame}
          />
        )}

        {gameState === GameState.PLAYING && currentScript && currentAssets && currentUser && (
          forceLandscapeOnMobile ? (
            <div className="absolute inset-0 z-50 bg-black">
              <div
                className="absolute top-0"
                style={{
                  left: 'calc(var(--app-vw, 1vw) * 100)',
                  width: 'calc(var(--app-vh, 1vh) * 100)',
                  height: 'calc(var(--app-vw, 1vw) * 100)',
                  transformOrigin: 'top left',
                  transform: 'rotate(90deg)',
                }}
              >
                <VisualNovelPlayer
                  script={currentScript}
                  assets={currentAssets}
                  userProfile={currentUser}
                  initialNodeId={initialNodeId}
                  initialAffinity={initialAffinity}
                  onExit={resetGame}
                  isTouchDevice={isTouchDevice}
                />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 z-50">
              <VisualNovelPlayer
                script={currentScript}
                assets={currentAssets}
                userProfile={currentUser}
                initialNodeId={initialNodeId}
                initialAffinity={initialAffinity}
                onExit={resetGame}
                isTouchDevice={isTouchDevice}
              />
            </div>
          )
        )}

      </div>
    </div>
  );
};

export default App;
