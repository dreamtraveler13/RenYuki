'use client';

import React, { useState, useEffect, useRef } from 'react';
import { GameState, GameScript, GeneratedAssets, UserProfile, SaveFile } from './types';
import GameCreationWizard from './components/GameCreationWizard';
import VisualNovelPlayer from './components/VisualNovelPlayer';
import LoginScreen from './components/LoginScreen';
import DevConsole from './components/DevConsole';
import Button from './components/Button';
import { getSaveList, deleteSave, restoreSave } from './services/storageService';
import payImg1 from './pay/pay1.png';
import payImg2 from './pay/pay2.png';
import payImg3 from './pay/pay3.png';
import payImg4 from './pay/pay4.png';
import payImg5 from './pay/pay5.png';
import payQr from './pay/pay.png';

const toSrc = (img: any): string => (typeof img === 'string' ? img : img?.src || '');
const PAY_IMAGES = [payImg1, payImg2, payImg3, payImg4, payImg5].map(toSrc);

const DelayedButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const timer = setTimeout(() => setReady(true), 6000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Button
      onClick={onConfirm}
      disabled={!ready}
      className={`w-full text-base md:text-lg py-3 transition-all ${ready ? 'opacity-100' : 'opacity-60 cursor-not-allowed'}`}
    >
      我已打赏，开始游玩
    </Button>
  );
};
type ShardPos = { top?: string; left?: string; right?: string; bottom?: string; rotate: string; scale: number };
const SHARD_POSITIONS: ShardPos[] = [
  // 环绕中心分布，留出中央空间给弹窗和二维码
  { top: '6%', left: '32%', rotate: '-10deg', scale: 1.1 },
  { top: '18%', left: '8%', rotate: '-6deg', scale: 1.05 },
  { top: '18%', right: '8%', rotate: '8deg', scale: 1.05 },
  { bottom: '10%', left: '20%', rotate: '-9deg', scale: 1.15 },
  { bottom: '10%', right: '20%', rotate: '9deg', scale: 1.15 },
];

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type AuthorStatus = {
  code: 'school' | 'sleep' | 'dev';
  title: string;
  subtitle: string;
};

const getAuthorStatus = (now = new Date()): AuthorStatus => {
  const day = now.getDay(); // 0 = Sun, 6 = Sat
  const minutes = now.getHours() * 60 + now.getMinutes();
  const isWeekday = day >= 1 && day <= 5;

  if (isWeekday) {
    if (minutes >= 23 * 60 || minutes < 6 * 60 + 40) {
      return { code: 'sleep', title: '睡觉中', subtitle: '别吵' };
    }
    if (minutes >= 6 * 60 + 40 && minutes < 20 * 60) {
      return { code: 'school', title: '上学中', subtitle: '上课想点子' };
    }
    return { code: 'dev', title: '放学了', subtitle: '估计在开发网站/抖音' };
  }

  // Weekend
  if (minutes < 8 * 60) {
    return { code: 'sleep', title: '睡觉中', subtitle: '别吵' };
  }
  return { code: 'dev', title: '周末网站/游戏/抖音', subtitle: '给我买杯奶茶吧'};
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.HOME);
  const [authToken, setAuthToken] = useState<string>('');
  // Set isLoggedIn to true by default to bypass initialization screen
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroidPrompt, setShowAndroidPrompt] = useState(false);
  
  const [currentScript, setCurrentScript] = useState<GameScript | null>(null);
  const [currentAssets, setCurrentAssets] = useState<GeneratedAssets | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [preloadedVoices, setPreloadedVoices] = useState<Record<string, string>>({});
  
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [saveList, setSaveList] = useState<SaveFile[]>([]);
  const [initialNodeId, setInitialNodeId] = useState<string | undefined>(undefined);
  const [initialAffinity, setInitialAffinity] = useState<number | undefined>(undefined);

  const [galleryHeroines, setGalleryHeroines] = useState<{name: string, image: string, id: number}[]>([]);
  const [authorStatus, setAuthorStatus] = useState<AuthorStatus>(() => getAuthorStatus());
  const [showAuthorPanel, setShowAuthorPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [playCount, setPlayCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = localStorage.getItem('playCount');
    const parsed = stored ? parseInt(stored, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  });
  const [showPayGate, setShowPayGate] = useState(false);

  const authorTheme: Record<AuthorStatus['code'], { bg: string; text: string; glow: string }> = {
    dev: { bg: 'bg-emerald-500', text: 'text-white', glow: 'shadow-[0_0_20px_rgba(16,185,129,0.4)]' },
    school: { bg: 'bg-sky-500', text: 'text-white', glow: 'shadow-[0_0_20px_rgba(14,165,233,0.4)]' },
    sleep: { bg: 'bg-slate-800', text: 'text-white', glow: 'shadow-[0_0_20px_rgba(51,65,85,0.4)]' },
  };

  const iosPromptOverlay = showIosPrompt ? (
    <div className="fixed inset-0 z-[30000] bg-black/80 text-white flex items-center justify-center p-6">
      <div className="bg-white text-black max-w-md w-full border-4 border-black shadow-2xl p-6 space-y-4 animate-pop relative">
        <h3 className="text-2xl font-black leading-tight">在苹果手机上三步安装到主屏幕</h3>
        <ol className="space-y-2 text-sm leading-relaxed list-decimal list-inside mt-2">
          <li>
            请用 <span className="font-bold">苹果自带浏览器</span> 打开这个页面（不要用微信/QQ 浏览器）。
          </li>
          <li>
            在屏幕底部中间，点
            <span className="font-bold">“分享”按钮（方框 + 向上箭头），然后下滑</span>。
          </li>
          <li>
            在菜单里点 <span className="font-bold">“添加到主屏幕”</span> → 右上角 <span className="font-bold">“添加”</span>，
            回到桌面从新图标进入游戏。
          </li>
        </ol>
        <p className="text-xs font-mono-tech text-gray-500 mt-2">
          建议使用苹果自带浏览器并添加到主屏幕，以获得更完整的音频与全屏体验
        </p>
        <Button
          onClick={() => setShowIosPrompt(false)}
          className="w-full"
        >
          我已添加到主屏幕
        </Button>
      </div>
    </div>
  ) : null;

  function dismissAndroidPrompt() {
    setShowAndroidPrompt(false);
  }

  const androidPromptOverlay = showAndroidPrompt && !isStandalone ? (
    <div className="fixed inset-0 z-[26000] bg-black/80 text-white flex items-center justify-center p-6">
      <div className="bg-white text-black max-w-md w-full border-4 border-black shadow-2xl p-6 space-y-4 animate-pop relative">
        <h3 className="text-2xl font-black uppercase leading-tight">安装到主屏幕</h3>
        <p className="text-sm leading-relaxed text-gray-800">
          检测到安卓设备，可一键添加网页到主屏幕，获得全屏体验。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button onClick={handleAndroidInstall} className="w-full">
            立即安装
          </Button>
          <Button
            onClick={dismissAndroidPrompt}
            className="w-full bg-gray-200 text-black hover:bg-gray-300 border border-black/20"
          >
            稍后再说
          </Button>
        </div>
        <p className="text-[11px] font-mono-tech text-gray-500">可安装到桌面，后续可从桌面图标直接打开</p>
      </div>
    </div>
  ) : null;

  useEffect(() => {
    // 1. Touch Detection (use pointer capability, not viewport ratio)
    const touchCapable = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(touchCapable);

    // 2. Fullscreen Listener
    const handleFsChange = () => {
      setIsFullScreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    
    // 3. iOS Check (request Add-to-Home-Screen before use)
    const ua = navigator.userAgent || '';
    const isIos =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes('Mac') && (navigator as any).maxTouchPoints > 2 && 'ontouchend' in document);
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(!!isStandaloneMode);
    if (isIos && !isStandaloneMode) {
      setShowIosPrompt(true);
    }

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
    if (typeof window === 'undefined') return;

    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js')
        .catch((err) => console.warn('Service worker registration failed', err));
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      if (!isAndroid || standalone) return;
      event.preventDefault();
      const promptEvent = event as BeforeInstallPromptEvent;
      setInstallPromptEvent(promptEvent);
      setShowAndroidPrompt(true);
    };

    const handleAppInstalled = () => {
      setInstallPromptEvent(null);
      setShowAndroidPrompt(false);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt as EventListener);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    const syncStatus = () => setAuthorStatus(getAuthorStatus());
    syncStatus();
    const timer = setInterval(syncStatus, 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const loadGallery = async () => {
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
  }, [gameState]);

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

  function handleAndroidInstall() {
    if (!installPromptEvent) return;
    setShowAndroidPrompt(false);
    installPromptEvent.prompt();
    installPromptEvent.userChoice
      .then((choice: any) => {
        if (!choice || choice.outcome !== 'accepted') {
          setInstallPromptEvent(null);
        }
      })
      .catch((err: any) => {
        console.warn('PWA install prompt failed', err);
        setInstallPromptEvent(null);
      });
  }

  const handleNudgeAuthor = () => {
    setShowAuthorPanel(false);
    setShowPayGate(true);
  };

  const handleLogin = (token: string, userProfile?: UserProfile) => {
    setAuthToken(token);
    setIsLoggedIn(true);
    if (userProfile && !currentUser) setCurrentUser(userProfile);
  };

  const proceedToGame = (
    script: GameScript, 
    assets: GeneratedAssets, 
    user: UserProfile,
    startNodeId?: string,
    startAffinity?: number
  ) => {
    const nextPlayCount = playCount + 1;
    setPlayCount(nextPlayCount);
    localStorage.setItem('playCount', String(nextPlayCount));

    setCurrentScript(script);
    setCurrentAssets(assets);
    setCurrentUser(user);
    setInitialNodeId(startNodeId);
    setInitialAffinity(startAffinity);
    setGameState(GameState.PLAYING);

    setShowPayGate(nextPlayCount >= 2);
  };

  const acknowledgeDonation = () => {
    setShowPayGate(false);
  };

  const startCreation = () => setGameState(GameState.CREATING);
  const startDevMode = () => setGameState(GameState.DEV);

  const handleVoiceReady = (nodeId: string, audioBase64: string) => {
    setPreloadedVoices(prev => ({ ...prev, [nodeId]: audioBase64 }));
    setCurrentAssets(prev => {
      if (!prev) return prev;
      return { ...prev, voice: { ...(prev.voice || {}), [nodeId]: audioBase64 } };
    });
  };

  const handleGameReady = (script: GameScript, assets: GeneratedAssets, user: UserProfile) => {
    const mergedAssets: GeneratedAssets = {
      ...assets,
      voice: { ...(assets.voice || {}), ...preloadedVoices },
    };
    setPreloadedVoices({});
    proceedToGame(script, mergedAssets, user);
  };

  const resetGame = () => {
    setGameState(GameState.HOME);
    setCurrentScript(null);
    setCurrentAssets(null);
    setCurrentUser(null);
    setPreloadedVoices({});
  };

  const openLoadMenu = async () => {
    try {
      const saves = await getSaveList();
      setSaveList(saves);
      setShowLoadMenu(true);
    } catch (e) { console.error(e); }
  };

  const loadSaveFile = (save: SaveFile) => {
    setShowLoadMenu(false);
    proceedToGame(save.script, save.assets, save.userProfile, save.currentNodeId, save.affinity);
  };

  const handleDeleteSave = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSave(id);
      setSaveList(prev => prev.filter(s => s.id !== id));
    } catch (err) { console.error(err); }
  };

  const handleExportSave = (save: SaveFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const dataStr = JSON.stringify(save);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `嘎拉存档_${save.heroineName}_${save.id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = event.target?.result as string;
        const data = JSON.parse(json);
        if (!data.script || !data.assets) {
          alert("无效的嘎拉文件");
          return;
        }
        await restoreSave(data);
        const saves = await getSaveList();
        setSaveList(saves);
      } catch (err) { alert("导入失败"); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const activeKey = authToken || '';

  // DEV MODE ROUTE
  if (gameState === GameState.DEV) {
    return <DevConsole authKey={activeKey} onExit={() => setGameState(GameState.HOME)} />;
  }

  if (!isLoggedIn) return (
    <>
      <div className="fixed top-4 right-4 z-[9999]">
          <button 
             onClick={toggleFullScreen}
             className="bg-black text-white px-3 py-1 text-xs font-mono-tech border border-white opacity-50 hover:opacity-100 transition-opacity"
          >
            {isFullScreen ? '[ EXIT ]' : '[ FULL ]'}
          </button>
      </div>
      
      {/* iOS Prompt Overlay - Only show if not covered by rotation prompt or if in portrait but not playing */}
      {iosPromptOverlay}
      {androidPromptOverlay}

      <LoginScreen onLogin={handleLogin} onEnterDevMode={() => { setIsLoggedIn(true); setAuthToken(''); startDevMode(); }} />
    </>
  );

  return (
    <div className="w-screen h-screen bg-[#f3f3f3] text-[#111] relative overflow-hidden flex font-sans">
      
      {iosPromptOverlay}
      {androidPromptOverlay}
      
      {/* Paywall Overlay (2nd generation and later) */}
      {showPayGate && (
       <div className="fixed inset-0 z-[20000] bg-black/80 backdrop-blur-lg flex justify-center items-start md:items-center overflow-y-auto p-4 md:p-8">
           <div className="absolute inset-0 pointer-events-none">
              {PAY_IMAGES.map((src, idx) => {
                 const pos = SHARD_POSITIONS[idx % SHARD_POSITIONS.length];
                 const blurOnCenter = idx === 4; // 背景中心的碎片虚化，避免遮挡主卡片
                 return (
                   <img
                     key={`m-${idx}`}
                     src={src}
                     className={`absolute object-cover opacity-80 drop-shadow-[0_0_25px_rgba(255,255,255,0.35)] animate-pop ${blurOnCenter ? 'blur-[4px] scale-110' : ''}`}
                     style={{
                       top: pos.top,
                       left: pos.left,
                       right: pos.right,
                       bottom: pos.bottom,
                       transform: `rotate(${pos.rotate}) scale(${pos.scale})`,
                       width: '38vw',
                       maxWidth: '420px',
                       minWidth: '200px',
                       borderRadius: '12px',
                       pointerEvents: 'none'
                     }}
                   />
                 );
              })}
           </div>
           <div
             className="relative bg-white text-black border-4 border-black px-6 py-8 md:px-10 md:py-12 text-center shadow-[0_0_40px_rgba(255,255,255,0.4)] my-8 overflow-auto rounded-2xl"
             style={{
               width: 'min(92vw, 520px)',
               maxWidth: '720px',
               maxHeight: '86vh'
             }}
           >
              <h2 className="text-2xl md:text-4xl font-black mb-4 uppercase tracking-tight">打赏一下吧</h2>
              <div className="text-sm md:text-base text-gray-900 mb-6 leading-relaxed space-y-6">
                <p className="font-extrabold">
                  每一次剧情生成、每一张立绘、每一句语音背后，都是真实的服务器成本。
                </p>
                <p className="font-extrabold">
                  我不想把创作变成付费墙，所以选择让所有功能完全开放，让每个人都能创造自己的故事。
                </p>
                <p className="font-extrabold">
                  你的打赏是对我最大的支持——哪怕是一根棒棒糖。
                </p>
              </div>
              <div className="flex justify-center mb-6">
                <img src={toSrc(payQr)} alt="打赏码" className="w-40 h-40 object-contain border border-black/20 shadow-md bg-white p-2" />
              </div>
              <DelayedButton key={showPayGate ? 'pay-open' : 'pay-closed'} onConfirm={acknowledgeDonation} />
           </div>
        </div>
      )}
      
      {/* GLOBAL: Landscape Enforcement Overlay */}
      {/* Applied globally when logged in to ensure mobile matches desktop layout */}
      {isLoggedIn && isTouchDevice && isPortrait && !showIosPrompt && (
        <div className="fixed inset-0 z-[11000] bg-[#111] text-white flex flex-col items-center justify-center text-center p-6 animate-fadeIn">
            <div className="text-6xl mb-6 animate-bounce font-mono-tech">↻</div>
            <h2 className="text-2xl font-black uppercase tracking-widest mb-2">请旋转设备</h2>
            <p className="text-gray-500 font-mono-tech text-xs uppercase">请切换到横屏</p>
            <div className="mt-8 border border-white/20 px-4 py-2 text-[10px] text-gray-400">
               SYSTEM_ERR: ORIENTATION_MISMATCH
            </div>
        </div>
      )}

      {/* Global Full Screen Toggle (Top Center) */}
      {gameState === GameState.HOME && !showLoadMenu && (
        <div className="fixed top-3 right-3 z-[14000] flex flex-col items-end gap-2 pointer-events-auto">
          <button
            onClick={() => setShowAuthorPanel((v) => !v)}
            className={`flex flex-col items-end px-4 py-3 rounded-xl border border-black/10 backdrop-blur ${authorTheme[authorStatus.code].bg} ${authorTheme[authorStatus.code].text} ${authorTheme[authorStatus.code].glow} shadow-lg hover:scale-[1.02] transition-all animate-pulse`}
          >
            <div className="text-[11px] uppercase font-mono-tech tracking-wide">作者现在在干嘛？</div>
            <div className="text-sm md:text-base font-black flex items-center gap-1">
              <span>{authorStatus.title}</span>
              <span className="text-xs opacity-80">▶</span>
            </div>
            <div className="text-[11px] opacity-80">{authorStatus.subtitle}</div>
          </button>

          {showAuthorPanel && (
            <div className="w-80 max-w-[88vw] bg-white/95 backdrop-blur border border-black/10 rounded-2xl shadow-2xl p-4 animate-pop text-left">
              <div className="text-sm font-black flex items-center gap-2 mb-1">
                <span className="text-emerald-600">•</span> 实时状态：{authorStatus.title}
              </div>
              <p className="text-xs text-gray-600 mb-3">{authorStatus.subtitle}</p>
              <div className="text-[11px] text-gray-700 space-y-1">
                <div className="font-bold text-black/80">作息</div>
                <div>周一-周五 06:40 - 20:00 上学</div>
                <div>周一-周五 23:00 - 06:40 睡觉</div>
                <div>周末 00:00 - 08:00 睡觉</div>
                <div>其他时间 = 网站/游戏/抖音</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={handleNudgeAuthor}
                  className="text-xs font-bold bg-black text-white rounded-lg py-2 px-3 hover:-translate-y-[1px] hover:shadow-lg transition-all"
                >
                  给作者买杯奶茶
                </button>
                <button
                  onClick={() => setShowAuthorPanel(false)}
                  className="text-xs font-bold bg-gray-100 text-gray-800 rounded-lg py-2 px-3 hover:bg-gray-200 transition-all"
                >
                  收起
                </button>
              </div>
              <div className="mt-2 text-[10px] text-gray-500">
                想催更/有好点子？请作者喝杯奶茶。
              </div>
            </div>
          )}
        </div>
      )}

      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto">
         <button 
           onClick={toggleFullScreen}
           className="bg-black/80 backdrop-blur text-white px-4 py-1 text-[10px] font-mono-tech uppercase tracking-widest border border-gray-600 hover:bg-black transition-all rounded-b-lg shadow-lg opacity-30 hover:opacity-100"
         >
            {isFullScreen ? '退出全屏' : '进入全屏'}
         </button>
      </div>

      {/* Decorative Background Grid */}
      <div className="absolute inset-0 z-0 opacity-10 pointer-events-none" 
           style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '40px 40px' }}>
      </div>

      <div className="relative z-10 w-full h-full flex">
        
        {/* Main Menu State */}
        {gameState === GameState.HOME && !showLoadMenu && (
          <div className="w-full h-full grid grid-cols-12 animate-fadeIn">
             
             {/* LEFT: Typography & Nav */}
             <div className="col-span-5 h-full flex flex-col justify-center px-4 md:px-8 lg:px-20 relative bg-white border-r border-black z-20">
                <div className="mb-8 lg:mb-20">
                    {/* Updated to use larger fonts on mobile to mimic desktop scale */}
                    <h1 className="text-4xl md:text-5xl lg:text-8xl font-black tracking-tighter leading-[0.8]">RenYuki</h1>
                    <h2 className="text-sm md:text-xl lg:text-4xl font-light uppercase tracking-[0.3em] mt-2 whitespace-nowrap">意淫你的嘎拉</h2>
                    <div className="w-8 md:w-16 lg:w-20 h-1 lg:h-2 bg-black mt-4 lg:mt-6"></div>
                </div>

                <div className="space-y-4 lg:space-y-6 flex flex-col items-start">
                   <button onClick={startCreation} className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left">
                      01 // 创建新嘎拉
                   </button>
                   <button onClick={openLoadMenu} className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left">
                      02 // 读取记忆
                   </button>
                   <button
                     onClick={() => setShowPayGate(true)}
                     className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left"
                   >
                      03 // 打赏作者
                   </button>
                   <button onClick={() => { setAuthToken(''); setIsLoggedIn(false); }} className="text-xs md:text-xs lg:text-sm font-mono-tech text-gray-400 hover:text-black mt-4 lg:mt-10">
                      // 退出登录
                   </button>
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

        {/* Load Menu Overlay */}
        {gameState === GameState.HOME && showLoadMenu && (
             <div className="absolute inset-0 z-50 bg-white flex flex-col animate-fadeIn">
                 <div className="h-14 lg:h-20 border-b border-black flex items-center justify-between px-4 lg:px-10 bg-gray-50">
                     <h2 className="text-xl lg:text-3xl font-black uppercase">记忆库</h2>
                     <div className="flex gap-2 lg:gap-4">
                        <input type="file" ref={fileInputRef} accept=".json" onChange={handleFileImport} className="hidden" />
                        <Button variant="secondary" onClick={handleImportClick} isTouch={isTouchDevice} className="!py-1 !px-2 lg:!py-2 lg:!px-4 text-[10px] lg:text-xs">导入</Button>
                        <button onClick={() => setShowLoadMenu(false)} className="text-2xl lg:text-4xl hover:rotate-90 transition-transform">×</button>
                     </div>
                 </div>
                 
                 <div className="flex-1 overflow-y-auto p-4 lg:p-10 bg-gray-100">
                     <div className="flex flex-col gap-6 lg:gap-10">
                         {saveList.length === 0 ? (
                             <div className="col-span-full text-center py-20 font-mono-tech text-gray-400">记忆库为空</div>
                         ) : (
                             saveList.map(save => (
                                 <div 
                                   key={save.id}
                                   onClick={() => loadSaveFile(save)}
                                   className="group relative bg-black cursor-pointer transition-all shadow-xl h-[calc(100vh-6rem)] w-full overflow-hidden"
                                 >
                                     <img
                                       src={`data:image/png;base64,${save.memoryCoverBase64 || save.assets.heroine.normal}`}
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
                                     <div className="absolute top-3 right-3 lg:top-6 lg:right-6 flex gap-2 text-xs lg:text-sm text-white/70 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                       <button
                                         onClick={(e) => handleExportSave(save, e)}
                                         title="下载"
                                         className="hover:text-white"
                                       >
                                         ⬇
                                       </button>
                                       <button
                                         onClick={(e) => handleDeleteSave(save.id, e)}
                                         title="删除"
                                         className="hover:text-red-400"
                                       >
                                         ✕
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
            authKey={activeKey}
            onGameReady={handleGameReady}
            onVoiceReady={handleVoiceReady}
            onCancel={resetGame}
          />
        )}

        {gameState === GameState.PLAYING && currentScript && currentAssets && currentUser && (
          <div className="absolute inset-0 z-50">
             <VisualNovelPlayer 
               script={currentScript}
               assets={currentAssets}
               userProfile={currentUser}
               authKey={activeKey}
               initialNodeId={initialNodeId}
               initialAffinity={initialAffinity}
               onExit={resetGame}
               onGameEnd={() => setShowPayGate(true)}
               isTouchDevice={isTouchDevice}
             />
          </div>
        )}

      </div>
    </div>
  );
};

export default App;
