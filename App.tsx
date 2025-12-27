'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AccountUser, GameState, GameScript, GeneratedAssets, SaveFile, UserProfile } from './types';
import BuyCoinsModal from './components/BuyCoinsModal';
import GalaPlazaModal from './components/GalaPlazaModal';
import GameCreationWizard from './components/GameCreationWizard';
import VisualNovelPlayer from './components/VisualNovelPlayer';
import LoginScreen from './components/LoginScreen';
import Button from './components/Button';
import { getSaveList, deleteSave } from './services/storageService';
import { authLogout, authMe } from './services/accountService';
import { publishPlazaGame } from './services/plazaService';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(GameState.HOME);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [accountUser, setAccountUser] = useState<AccountUser | null>(null);
  const [showBuyCoins, setShowBuyCoins] = useState(false);
  const [showPlaza, setShowPlaza] = useState(false);
  const [publishingSaveId, setPublishingSaveId] = useState<number | null>(null);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const publishTimerRef = useRef<number | null>(null);
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
  
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [saveList, setSaveList] = useState<SaveFile[]>([]);
  const [initialNodeId, setInitialNodeId] = useState<string | undefined>(undefined);
  const [initialAffinity, setInitialAffinity] = useState<number | undefined>(undefined);

  const [galleryHeroines, setGalleryHeroines] = useState<{name: string, image: string, id: number}[]>([]);
  const coins = accountUser?.coins ?? 0;

  const iosPromptOverlay = showIosPrompt ? (
    <div className="fixed inset-0 z-[30000] bg-black/80 text-white flex items-center justify-center p-6 overlay-fade-in">
      <div className="bg-white text-black max-w-md w-full border-4 border-black shadow-2xl p-6 space-y-4 relative modal-scale-in">
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
    <div className="fixed inset-0 z-[26000] bg-black/80 text-white flex items-center justify-center p-6 overlay-fade-in">
      <div className="bg-white text-black max-w-md w-full border-4 border-black shadow-2xl p-6 space-y-4 relative modal-scale-in">
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
      <div className="relative h-[62%] w-full overflow-hidden bg-gray-100">
        <div className="absolute inset-0 z-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
        
        {/* Diagonal Cut Overlay */}
        <div className="absolute bottom-0 left-0 w-full h-16 bg-white transform -skew-y-3 origin-bottom-left z-20 scale-110 translate-y-8"></div>

        <div className="absolute inset-0 flex items-end justify-center z-10 pb-8">
          {galleryHeroines.length > 0 ? (
            <div className="relative w-full h-full animate-fade-in">
              {galleryHeroines.map((h) => (
                <div
                  key={h.id}
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 filter contrast-110"
                  style={{ width: 'auto', height: '100%' }}
                >
                  <img
                    src={`data:image/png;base64,${h.image}`}
                    className="h-[90%] w-auto object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
                    alt={h.name}
                  />
                  {/* Floating Tag */}
                  <div className="absolute top-1/4 right-0 bg-black/80 backdrop-blur text-white text-[9px] font-mono-tech px-2 py-1 border-l-2 border-white stagger-enter stagger-3">
                    ID: {h.name.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
             <div className="w-full h-full flex items-center justify-center">
                <div className="text-4xl font-black text-gray-200 -rotate-90 tracking-widest opacity-30">NO_DATA</div>
             </div>
          )}
        </div>
      </div>

      {/* BOTTOM SECTION: CONTROLS (38%) */}
      <div className="flex-1 bg-white relative z-30 px-6 pt-2 pb-8 flex flex-col justify-between">
        {/* Header */}
        <div className="stagger-enter stagger-1">
          <h1 className="text-5xl font-black tracking-tighter leading-[0.8] mb-1">RenYuki</h1>
          <div className="flex items-center gap-3">
             <div className="h-0.5 w-8 bg-black"></div>
             <span className="text-xs font-mono-tech text-gray-400 tracking-widest uppercase">Mobile Interface v2.1</span>
          </div>
        </div>

        {/* Menu Items */}
        <div className="flex flex-col gap-3 mt-4">
          <button
            onClick={startCreation}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-2 touch-active"
          >
            <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">创建新嘎拉</span>
            <span className="font-mono-tech text-xs text-gray-400">01 // CREATE</span>
          </button>

          <button
            onClick={openLoadMenu}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-3 touch-active"
          >
            <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">读取记忆</span>
            <span className="font-mono-tech text-xs text-gray-400">02 // LOAD</span>
          </button>

          <button
            onClick={() => setShowPlaza(true)}
            className="group flex items-center justify-between border-b border-gray-200 py-3 active:border-black transition-colors stagger-enter stagger-4 touch-active"
          >
             <span className="text-xl font-bold tracking-wide group-active:translate-x-1 transition-transform">嘎拉广场</span>
             <span className="font-mono-tech text-xs text-gray-400">03 // PLAZA</span>
          </button>
        </div>

        {/* Footer */}
        <div className="text-[9px] text-gray-300 font-mono-tech leading-tight stagger-enter stagger-5 text-center mt-auto pt-4">
          REN_YUKI PROJECT © 2025 <br/> AI GENERATED CONTENT / SAFETY PROTOCOLS ACTIVE
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
    resetGame();
  };

  const handleGameReady = (script: GameScript, assets: GeneratedAssets, user: UserProfile) => {
    proceedToGame(script, assets, user);
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
      const ok = await copyText(url);
      setPublishMessage(ok ? '已发布，分享链接已复制' : '已发布，可复制分享链接');
      setShowPlaza(true);
      setShowLoadMenu(false);
    } catch (err: any) {
      setPublishMessage(err?.message || '发布失败');
    } finally {
      setPublishingSaveId(null);
    }
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

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
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
      {/* iOS Prompt Overlay - Only show if not covered by rotation prompt or if in portrait but not playing */}
      {iosPromptOverlay}
      {androidPromptOverlay}

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
      
      {iosPromptOverlay}
      {androidPromptOverlay}

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
                充值
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
      
      {/* GLOBAL: Landscape Enforcement Overlay */}
      {/* Applied globally when logged in to ensure mobile matches desktop layout */}
      {gameState === GameState.PLAYING && isTouchDevice && isPortrait && !showIosPrompt && (
        <div className="fixed inset-0 z-[11000] bg-[#111] text-white flex flex-col items-center justify-center text-center p-6 overlay-fade-in">
            <div className="text-6xl mb-6 animate-bounce font-mono-tech">↻</div>
            <h2 className="text-2xl font-black uppercase tracking-widest mb-2">请旋转设备</h2>
            <p className="text-gray-500 font-mono-tech text-xs uppercase">请切换到横屏</p>
            <div className="mt-8 border border-white/20 px-4 py-2 text-[10px] text-gray-400">
               SYSTEM_ERR: ORIENTATION_MISMATCH
            </div>
        </div>
      )}

      {publishMessage && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[25000] bg-black text-white px-3 py-2 rounded-xl text-xs font-mono-tech toast-slide-in">
          {publishMessage}
        </div>
      )}

      {gameState === GameState.PLAYING && (
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
                     onClick={() => setShowPlaza(true)}
                     className="text-lg md:text-xl lg:text-2xl font-bold hover:bg-black hover:text-white px-2 md:px-4 py-2 transition-all -ml-2 md:-ml-4 uppercase tracking-wider text-left"
                   >
                      03 // 嘎拉广场
                   </button>
                </div>

                <div className="mt-10 lg:mt-14 text-[10px] lg:text-[11px] text-gray-400/60 leading-relaxed max-w-md select-none">
                  本站为 AI 生成内容演示/娱乐用途；请勿上传或生成违法、色情、暴力、侵权或涉及未成年人的内容。由用户输入/上传导致的后果由用户自行承担。
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
                     <h2 className="text-xl lg:text-3xl font-black uppercase">记忆库</h2>
                     <div className="flex gap-2 lg:gap-4">
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
                                     <div className="absolute top-3 right-3 lg:top-6 lg:right-6 flex items-center gap-2 z-20">
                                       <button
                                         onClick={(e) => handlePublishSaveToPlaza(save, e)}
                                         title="发布并复制分享链接"
                                         className="bg-white text-black hover:bg-white/95 px-3 py-2 rounded-xl font-black shadow-xl border border-black/10"
                                         disabled={publishingSaveId === save.id}
                                       >
                                         {publishingSaveId === save.id ? '发布中…' : '发布并复制链接'}
                                       </button>
                                       <div className="flex gap-2 text-xs lg:text-sm text-white/70 opacity-90 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                         <button
                                           onClick={(e) => handleDeleteSave(save.id, e)}
                                           title="删除"
                                           className="hover:text-red-400"
                                         >
                                           ✕
                                         </button>
                                       </div>
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
            onGameReady={handleGameReady}
            onCoinsUpdated={(newCoins) =>
              setAccountUser((prev) => (prev ? { ...prev, coins: newCoins } : prev))
            }
            onNeedCoins={() => setShowBuyCoins(true)}
            onCancel={resetGame}
          />
        )}

        {gameState === GameState.PLAYING && currentScript && currentAssets && currentUser && (
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
        )}

      </div>
    </div>
  );
};

export default App;
