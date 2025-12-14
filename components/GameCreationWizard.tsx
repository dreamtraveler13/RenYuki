'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CharacterImages, GameScript, GeneratedAssets, UserProfile } from '../types';
import Button from './Button';
import { fileToBase64, generateGameScript, generateImage, generateProtagonistSprite, generateHeroineSprite } from '../services/aiService';
import { walletBalance } from '../services/accountService';
import { saveGame } from '../services/storageService';

interface Props {
  authKey: string;
  onGameReady: (script: GameScript, assets: GeneratedAssets, user: UserProfile) => void;
  onVoiceReady?: (nodeId: string, audioBase64: string) => void;
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

const GameCreationWizard: React.FC<Props> = ({ authKey, onGameReady, onCoinsUpdated, onNeedCoins, onCancel }) => {
  const mountedRef = useRef(true);
  const [step, setStep] = useState<'upload' | 'generating'>('upload');
  const [loadingStatus, setLoadingStatus] = useState('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  const [userName, setUserName] = useState('');
  const [heroineName, setHeroineName] = useState('');
  const [plotDescription, setPlotDescription] = useState('');
  const [maxMode, setMaxMode] = useState(false);
  
  const [protagonistPhoto, setProtagonistPhoto] = useState<string | undefined>(undefined);
  const [protagonistMimeType, setProtagonistMimeType] = useState<string>('image/jpeg');

  const [heroinePhoto, setHeroinePhoto] = useState<string | undefined>(undefined);
  const [heroineMimeType, setHeroineMimeType] = useState<string>('image/jpeg');


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

  const handleStart = async () => {
    if (!userName) return;

    if (mountedRef.current) {
      setErrorMessage('');
      setStep('generating');
    }

    try {
      const targetHeroine = heroineName.trim() || "Unit-01";

      // 1) Start core tasks in parallel (script + sprites)
      if (mountedRef.current) setLoadingStatus('正在生成剧本');
      const scriptPromise = generateGameScript(userName, targetHeroine, plotDescription, maxMode);

      const protagonistPromise: Promise<CharacterImages> = (async () => {
        if (mountedRef.current) setLoadingStatus('正在生成主角立绘');

        if (protagonistPhoto) {
          if (maxMode) {
            const [normal, happy, surprised, angry] = await Promise.all([
              generateProtagonistSprite('confident smile', protagonistPhoto, undefined, authKey, protagonistMimeType),
              generateProtagonistSprite('bright happy smile', protagonistPhoto, undefined, authKey, protagonistMimeType),
              generateProtagonistSprite('surprised, jaw drop, shock', protagonistPhoto, undefined, authKey, protagonistMimeType),
              generateProtagonistSprite('annoyed, angry, slightly frowning', protagonistPhoto, undefined, authKey, protagonistMimeType),
            ]);
            return { normal, happy, surprised, angry, shy: happy };
          }

          const [normal, surprised] = await Promise.all([
            generateProtagonistSprite('confident smile', protagonistPhoto, undefined, authKey, protagonistMimeType),
            generateProtagonistSprite('surprised, jaw drop, shock', protagonistPhoto, undefined, authKey, protagonistMimeType),
          ]);
          return { normal, happy: normal, surprised, angry: surprised, shy: normal };
        }

        const normal = await generateProtagonistSprite('confident smile', undefined, undefined, authKey);
        if (maxMode) {
          const [happy, surprised, angry] = await Promise.all([
            generateProtagonistSprite('bright happy smile', undefined, normal, authKey),
            generateProtagonistSprite('surprised, jaw drop, shock', undefined, normal, authKey),
            generateProtagonistSprite('annoyed, angry, slightly frowning', undefined, normal, authKey),
          ]);
          return { normal, happy, surprised, angry, shy: happy };
        }

        const surprised = await generateProtagonistSprite('surprised, jaw drop, shock', undefined, normal, authKey);
        return { normal, happy: normal, surprised, angry: surprised, shy: normal };
      })();

      const heroinePromise: Promise<CharacterImages> = (async () => {
        if (mountedRef.current) setLoadingStatus(`正在生成女主立绘（${targetHeroine}）`);

        if (heroinePhoto) {
          if (maxMode) {
            const [normal, happy, shy, surprised, angry, sad] = await Promise.all([
              generateHeroineSprite('gentle smile', undefined, heroinePhoto, authKey, heroineMimeType),
              generateHeroineSprite('laughing happily', undefined, heroinePhoto, authKey, heroineMimeType),
              generateHeroineSprite('blushing shy', undefined, heroinePhoto, authKey, heroineMimeType),
              generateHeroineSprite('surprised, wide eyes, slight gasp', undefined, heroinePhoto, authKey, heroineMimeType),
              generateHeroineSprite('pouting, angry, cheeks slightly puffed', undefined, heroinePhoto, authKey, heroineMimeType),
              generateHeroineSprite('sad, watery eyes, holding back tears', undefined, heroinePhoto, authKey, heroineMimeType),
            ]);
            return { normal, happy, shy, surprised, angry, sad };
          }

          const [normal, happy, shy] = await Promise.all([
            generateHeroineSprite('gentle smile', undefined, heroinePhoto, authKey, heroineMimeType),
            generateHeroineSprite('laughing happily', undefined, heroinePhoto, authKey, heroineMimeType),
            generateHeroineSprite('blushing shy', undefined, heroinePhoto, authKey, heroineMimeType),
          ]);
          return { normal, happy, shy, surprised: normal, angry: normal };
        }

        const normal = await generateHeroineSprite('gentle smile', undefined, undefined, authKey);
        if (mountedRef.current) setLoadingStatus('正在生成女主其他表情');

        if (maxMode) {
          const [happy, shy, surprised, angry, sad] = await Promise.all([
            generateHeroineSprite('laughing happily', normal, undefined, authKey),
            generateHeroineSprite('blushing shy', normal, undefined, authKey),
            generateHeroineSprite('surprised, wide eyes, slight gasp', normal, undefined, authKey),
            generateHeroineSprite('pouting, angry, cheeks slightly puffed', normal, undefined, authKey),
            generateHeroineSprite('sad, watery eyes, holding back tears', normal, undefined, authKey),
          ]);
          return { normal, happy, shy, surprised, angry, sad };
        }

        const [happy, shy] = await Promise.all([
          generateHeroineSprite('laughing happily', normal, undefined, authKey),
          generateHeroineSprite('blushing shy', normal, undefined, authKey),
        ]);
        return { normal, happy, shy, surprised: normal, angry: normal };
      })();

      const script = await scriptPromise;
      try {
        const coins = await walletBalance();
        onCoinsUpdated?.(coins);
      } catch {}

      // 2) Backgrounds (depend on script) - full parallel
      const backgroundsPromise = (async () => {
        const backgrounds: Record<string, string> = {};
        const uniqueBgPrompts = Array.from(
          new Set(Object.values(script.nodes).map(n => n.backgroundPrompt).filter(Boolean) as string[])
        );
        if (uniqueBgPrompts.length === 0) uniqueBgPrompts.push("Modern minimalist classroom, high contrast, clean, anime style");

        let bgDone = 0;
        if (mountedRef.current) setLoadingStatus(`正在生成背景（${bgDone}/${uniqueBgPrompts.length}）`);

        const results = await Promise.all(
          uniqueBgPrompts.filter(Boolean).map(async (prompt) => {
            try {
              const img = await generateImage(prompt, authKey);
              return { prompt, img };
            } finally {
              bgDone += 1;
              if (mountedRef.current) setLoadingStatus(`正在生成背景（${bgDone}/${uniqueBgPrompts.length}）`);
            }
          })
        );

        results.forEach((r) => {
          if (r?.prompt && r?.img) backgrounds[r.prompt] = r.img;
        });

        return backgrounds;
      })();

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

      // 5. Audio (TTS & BGM)
      if (mountedRef.current) setLoadingStatus('正在加载背景音乐');
      const voiceData: Record<string, string> = {};
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

      // 5.2 TTS is temporarily disabled

      const finalUserProfile: UserProfile = {
          name: userName,
          avatarBase64: protagonistPhoto || String(protagonistAssets.normal || '') 
      };

      const finalAssets: GeneratedAssets = {
        protagonist: protagonistAssets,
        heroine: heroineAssets,
        backgrounds,
        voice: voiceData,
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
    <div className="w-full h-full flex items-center justify-center p-2 md:p-10">
      <div className="w-full max-w-6xl tech-panel h-full md:h-[90vh] flex flex-col relative overflow-hidden bg-white">
        
        {/* Header Bar */}
        <div className="h-12 md:h-16 border-b border-black flex items-center justify-between px-4 md:px-8 bg-gray-50 shrink-0">
            <h2 className="text-sm md:text-xl font-bold tracking-widest uppercase">创建新嘎拉</h2>
            <div className="text-[10px] md:text-xs font-mono-tech text-gray-500">编号：#001</div>
        </div>

        {step === 'upload' && (
          <div className="flex-1 overflow-y-auto p-4 md:p-16 animate-glitch">
            {errorMessage && (
              <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-3 rounded flex items-start gap-3">
                <div className="font-mono-tech text-[11px] uppercase">错误</div>
                <div className="flex-1 text-sm leading-snug">
                  生成失败：{errorMessage}。请检查网络、环境变量或稍后重试。
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
            <div className="mb-6 md:mb-12">
               <div className="border-l-2 border-black pl-3 md:pl-4 mb-2 md:mb-4">
                  <h3 className="text-lg md:text-2xl font-black uppercase mb-0 md:mb-1">场景设定</h3>
                  <p className="text-[10px] md:text-xs text-gray-500 font-mono-tech">用于生成剧情的设定</p>
               </div>
	               <div>
	                  <textarea 
	                    value={plotDescription}
	                    onChange={(e) => setPlotDescription(e.target.value)}
	                    className="w-full tech-input py-1 md:py-3 text-sm md:text-lg font-medium h-16 md:h-24 resize-none"
	                    placeholder="例如：在屋顶一起吃午饭。"
	                  />
	               </div>
	               <div className="mt-3 flex items-center justify-between gap-3">
	                  <label className="flex items-center gap-2 select-none cursor-pointer">
	                    <input
	                      type="checkbox"
	                      checked={maxMode}
	                      onChange={(e) => setMaxMode(e.target.checked)}
	                      className="h-4 w-4 accent-black"
	                    />
	                    <span className="text-xs md:text-sm font-bold tracking-widest uppercase">MAX MODE</span>
	                  </label>
	                  <div className="text-[10px] md:text-xs text-gray-500 font-mono-tech">
	                    MAX MODE 消耗 2 个嘎拉币（普通 1 个），立绘数量和质量会显著提升。
	                  </div>
	               </div>
	            </div>

            {/* Forced 2-column layout to match desktop */}
            <div className="grid grid-cols-2 gap-8 md:gap-16">
              
              {/* Left Column: Protagonist */}
              <div className="space-y-4 md:space-y-8">
                  <div className="border-l-2 border-black pl-3 md:pl-4">
                    <h3 className="text-lg md:text-2xl font-black uppercase mb-0 md:mb-1">主角</h3>
                  </div>
                  
                  <div className="group">
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1 md:mb-2 text-gray-400">名字</label>
                    <input 
                      type="text" 
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      className="w-full tech-input py-1 md:py-3 text-base md:text-xl font-medium"
                      placeholder="请输入主角名字"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1 md:mb-2 text-gray-400">照片（可选）</label>
                    <div className="border border-dashed border-gray-400 hover:border-black p-2 md:p-4 transition-all cursor-pointer relative h-20 md:h-32 flex items-center justify-center bg-gray-50 hover:bg-white group">
                      <input type="file" accept="image/*" onChange={handleProtagonistUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                      {protagonistPhoto ? (
                        <img src={`data:${protagonistMimeType};base64,${protagonistPhoto}`} className="h-full object-contain" alt="预览" />
                      ) : (
                        <div className="text-center group-hover:scale-105 transition-transform">
                          <span className="text-[10px] md:text-xs font-mono-tech text-gray-400">上传图片</span>
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-400 font-mono-tech mt-1 opacity-70">
                      请勿上传违法、色情、暴力或侵犯他人肖像权的照片，后果自负。
                    </div>
                  </div>
              </div>

              {/* Right Column: Heroine */}
              <div className="space-y-4 md:space-y-8">
                  <div className="border-l-2 border-black pl-3 md:pl-4">
                    <h3 className="text-lg md:text-2xl font-black uppercase mb-0 md:mb-1">女主角</h3>
                  </div>

                   <div className="group">
                     <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1 md:mb-2 text-gray-400">名字</label>
                     <input 
                       type="text" 
                       value={heroineName}
                       onChange={(e) => setHeroineName(e.target.value)}
                       className="w-full tech-input py-1 md:py-3 text-base md:text-xl font-medium"
                       placeholder="请输入女主名字"
                     />
                   </div>

                   <div>
                    <label className="block text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1 md:mb-2 text-gray-400">照片（可选）</label>
                    <div className="border border-dashed border-gray-400 hover:border-black p-2 md:p-4 transition-all cursor-pointer relative h-20 md:h-32 flex items-center justify-center bg-gray-50 hover:bg-white group">
                      <input type="file" accept="image/*" onChange={handleHeroineUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                      {heroinePhoto ? (
                        <img src={`data:${heroineMimeType};base64,${heroinePhoto}`} className="h-full object-contain" alt="预览" />
                      ) : (
                        <div className="text-center group-hover:scale-105 transition-transform">
                          <span className="text-[10px] md:text-xs font-mono-tech text-gray-400">上传图片</span>
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-400 font-mono-tech mt-1 opacity-70">
                      请勿上传违法、色情、暴力或侵犯他人肖像权的照片，后果自负。
                    </div>
                  </div>
            </div>
          </div>

            <div className="mt-8 md:mt-16 flex flex-col gap-3 md:gap-4 border-t border-gray-200 pt-4 md:pt-8 pb-4">
               <div className="text-[10px] md:text-xs text-gray-500 font-mono-tech">
                 生成需等待本页完成，请勿关闭。
               </div>
               <div className="text-[9px] text-gray-300 font-mono-tech">
                  免责声明：生成内容仅供娱乐，上传素材请遵守法律法规，责任自负。
               </div>
               <div className="flex flex-col md:flex-row md:items-center md:justify-end gap-3 md:gap-6">
                 <button onClick={onCancel} className="text-gray-400 hover:text-black font-bold uppercase tracking-widest text-xs md:text-sm">取消</button>
                 <Button 
                   onClick={handleStart} 
                   disabled={!userName}
                   className="w-full md:w-40"
                 >
                   {!userName ? "请先填写主角名字" : maxMode ? "开始生成（2 嘎拉币）" : "开始生成（1 嘎拉币）"}
                 </Button>
               </div>
            </div>
          </div>
        )}

        {step === 'generating' && (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 md:space-y-8 bg-black text-white p-4">
             <div className="w-full max-w-md space-y-2">
                <div className="flex justify-between font-mono-tech text-[10px] md:text-xs text-gray-400">
                   <span>处理中</span>
                    <span className="animate-pulse">进行中…</span>
                 </div>
                 <div className="h-1 w-full bg-gray-800 overflow-hidden">
                    <div className="h-full bg-white animate-progress w-full origin-left" style={{ animation: 'glitch-load 2s infinite' }}></div>
                 </div>
                 <h3 className="text-xl md:text-4xl font-black uppercase mt-4 animate-pulse text-center">{loadingStatus}</h3>
                 <p className="text-center text-[10px] md:text-xs text-gray-400 mt-2 font-mono-tech tracking-widest uppercase">
                    预计需要几分钟，请勿退出页面或熄屏
                 </p>
            </div>
         </div>
       )}

      </div>
    </div>
  );
};

export default GameCreationWizard;
