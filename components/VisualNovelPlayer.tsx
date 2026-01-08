'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { GameScript, GeneratedAssets, SpeakerType, Choice, StoryNode, UserProfile, SaveFile } from '../types';
import Button from './Button';
import Typewriter from './Typewriter';
import CopyLinkModal from './CopyLinkModal';
import { saveGame } from '../services/storageService';
import { publishPlazaGame } from '../services/plazaService';
import { generateHeroineVoice } from '../services/aiService';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';
const AUDIO_LIBRARY: Record<string, string> = {
  bgm_bossa: "/music/song1.mp3",
  bgm_playful: "/music/song2.mp3",
  bgm_piano: "/music/song3.mp3",
  bgm_night: "/music/song4.mp3",
  bgm_sad: "/music/song5.mp3",
  bgm_dream: "/music/song6.mp3",
  bgm_morning: "/music/song7.mp3",
};

interface Props {
  script: GameScript;
  assets: GeneratedAssets;
  userProfile: UserProfile;
  initialNodeId?: string;
  initialAffinity?: number;
  onExit: () => void;
  onGameEnd?: () => void;
  isTouchDevice: boolean;
  enableContinue?: boolean;
}

// Helper: Decode standard audio formats (MP3, WAV) from Base64
// Used for Background Music
const decodeStandardAudio = async (base64Data: string, audioContext: AudioContext): Promise<AudioBuffer> => {
  const binaryString = window.atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // decodeAudioData handles MP3 headers automatically
  return await audioContext.decodeAudioData(bytes.buffer);
};

const decodeUrlAudio = async (url: string, audioContext: AudioContext): Promise<AudioBuffer> => {
  const resp = await fetch(url, { cache: 'force-cache' });
  if (!resp.ok) throw new Error(`Audio fetch failed: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return await audioContext.decodeAudioData(buf);
};

const CrossfadeImage = ({ src, alt, className, style }: { src: string, alt: string, className: string, style?: React.CSSProperties }) => {
  const [prevSrc, setPrevSrc] = useState<string | null>(null);
  const [currentSrc, setCurrentSrc] = useState(src);
  
  if (src !== currentSrc) {
    setPrevSrc(currentSrc);
    setCurrentSrc(src);
  }

  useEffect(() => {
    if (prevSrc) {
      const timer = setTimeout(() => {
        setPrevSrc(null);
      }, 500); // 0.5s overlap
      return () => clearTimeout(timer);
    }
  }, [prevSrc]);

  return (
    <div className={`grid grid-cols-1 grid-rows-1 ${className}`} style={style}>
      {prevSrc && (
        <img 
          key={prevSrc}
          src={prevSrc} 
          alt={alt} 
          className="col-start-1 row-start-1 w-auto h-full object-contain animate-fade-out-overlap"
        />
      )}
      <img 
        key={currentSrc}
        src={currentSrc} 
        alt={alt} 
        className={`col-start-1 row-start-1 w-auto h-full object-contain ${prevSrc ? 'animate-fade-in-overlap' : ''}`}
      />
      <style jsx>{`
        .animate-fade-in-overlap {
          animation: fadeInOverlap 0.35s ease-in-out forwards;
        }
        .animate-fade-out-overlap {
          animation: fadeOutOverlap 0.35s ease-in-out forwards;
        }
        @keyframes fadeInOverlap {
          from { opacity: 0; filter: blur(6px); transform: translateY(6px); }
          to { opacity: 1; filter: blur(0); transform: translateY(0); }
        }
        @keyframes fadeOutOverlap {
          from { opacity: 1; filter: blur(0); transform: translateY(0); }
          to { opacity: 0; filter: blur(6px); transform: translateY(6px); }
        }
      `}</style>
    </div>
  );
};

const getHeroineVoiceText = (node?: StoryNode) => {
  if (!node) return '';
  return (node.textJP || node.textCN || '').trim();
};

const VisualNovelPlayer: React.FC<Props> = ({ script, assets, userProfile, initialNodeId, initialAffinity, onExit, onGameEnd, isTouchDevice, enableContinue = true }) => {
  const [runtimeScript, setRuntimeScript] = useState<GameScript>(script);
  const [hasStarted, setHasStarted] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [allowNonFullscreen, setAllowNonFullscreen] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState<string>(initialNodeId || script.startNodeId);
  const [affinity, setAffinity] = useState(initialAffinity || 50);
  const [currentBackground, setCurrentBackground] = useState<string | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [endNotified, setEndNotified] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState<string | null>(null);
  const [publishLink, setPublishLink] = useState<string | null>(null);
  const [currentBgmKey, setCurrentBgmKey] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);
  const [dialogueHistory, setDialogueHistory] = useState<Array<{ speaker: string; textCN: string }>>([]);
  const [newOptionText, setNewOptionText] = useState('');
  const [waitingForNodeId, setWaitingForNodeId] = useState<string | null>(null);
  const [continuingChoiceIndex, setContinuingChoiceIndex] = useState<number | null>(null);
  const [voiceCache, setVoiceCache] = useState<Record<string, string>>(() => assets.voice || {});
  const voiceCacheRef = useRef<Record<string, string>>(voiceCache);
  const voiceFetchRef = useRef<Set<string>>(new Set());
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedVoiceRef = useRef<{ nodeId: string; audioSrc: string } | null>(null);
  const [visitStack, setVisitStack] = useState<Array<{ nodeId: string; affinity: number }>>(() => [
    { nodeId: initialNodeId || script.startNodeId, affinity: initialAffinity || 50 },
  ]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgmSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bgmGainRef = useRef<GainNode | null>(null);
  const bgmBufferCacheRef = useRef<Record<string, AudioBuffer>>({});
  const isRestoringHistoryRef = useRef(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(!!standalone);

    const update = () => setIsFullScreen(!!document.fullscreenElement);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);

  useEffect(() => {
    setRuntimeScript(script);
    setCurrentNodeId(initialNodeId || script.startNodeId);
    setAffinity(initialAffinity || 50);
    setVisitStack([{ nodeId: initialNodeId || script.startNodeId, affinity: initialAffinity || 50 }]);
    setWaitingForNodeId(null);
    setContinueError(null);
    setIsContinuing(false);
    setContinuingChoiceIndex(null);
    setVoiceCache(assets.voice || {});
    voiceFetchRef.current = new Set();
  }, [script, initialNodeId, initialAffinity, assets.voice]);

  useEffect(() => {
    voiceCacheRef.current = voiceCache;
  }, [voiceCache]);

  const currentNode: StoryNode | undefined = runtimeScript.nodes[currentNodeId];
  const isUserChoiceNode = !!currentNode && currentNode.nodeType === 'user_choice';
  const hasProtagonist = useMemo(() => {
    const imgs = assets?.protagonist;
    if (!imgs) return false;
    return Object.values(imgs).some((v) => typeof v === 'string' && v.trim().length > 0);
  }, [assets?.protagonist]);
  const heroineActive = currentNode?.speaker === SpeakerType.HEROINE || !hasProtagonist;
  const assetsWithVoice = useMemo(() => ({ ...assets, voice: voiceCache }), [assets, voiceCache]);

  const collectUpcomingHeroineNodes = useCallback(
    (startId: string, count: number) => {
      const nodes: StoryNode[] = [];
      let currentId = runtimeScript.nodes[startId]?.nextNodeId || '';
      const visited = new Set<string>();
      while (currentId && nodes.length < count && !visited.has(currentId)) {
        visited.add(currentId);
        const node = runtimeScript.nodes[currentId];
        if (!node) break;
        if (node.speaker === SpeakerType.HEROINE) nodes.push(node);
        currentId = node.nextNodeId || '';
      }
      return nodes;
    },
    [runtimeScript]
  );

  const ensureVoiceForNodes = useCallback(async (nodes: StoryNode[]) => {
    for (const node of nodes) {
      const text = getHeroineVoiceText(node);
      if (!text) continue;
      if (voiceCacheRef.current[node.id]) continue;
      if (voiceFetchRef.current.has(node.id)) continue;
      voiceFetchRef.current.add(node.id);
      try {
        const audioDataUrl = await generateHeroineVoice(text);
        setVoiceCache((prev) => ({ ...prev, [node.id]: audioDataUrl }));
      } catch (err) {
        console.warn('heroine tts failed', err);
      } finally {
        voiceFetchRef.current.delete(node.id);
      }
    }
  }, []);

  // Helper function: If isTouchDevice is true, suppress the desktop (lg:) classes
  // This forces the UI to stay compact even on high-res tablets or phones
  const d = (cls: string) => isTouchDevice ? '' : cls;

  // Initialize Audio
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    return () => {
      bgmSourceRef.current?.stop();
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!currentNode) return;
    const nodesToFetch: StoryNode[] = [];
    if (currentNode.speaker === SpeakerType.HEROINE) nodesToFetch.push(currentNode);
    nodesToFetch.push(...collectUpcomingHeroineNodes(currentNode.id, 2));
    if (nodesToFetch.length > 0) {
      void ensureVoiceForNodes(nodesToFetch);
    }
  }, [currentNode, collectUpcomingHeroineNodes, ensureVoiceForNodes]);

  useEffect(() => {
    if (!currentNode || currentNode.speaker !== SpeakerType.HEROINE) return;
    const audioSrc = voiceCache[currentNode.id];
    if (!audioSrc) return;
    if (
      lastPlayedVoiceRef.current &&
      lastPlayedVoiceRef.current.nodeId === currentNode.id &&
      lastPlayedVoiceRef.current.audioSrc === audioSrc
    ) {
      return;
    }
    let audio = voiceAudioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      voiceAudioRef.current = audio;
    }
    audio.pause();
    audio.currentTime = 0;
    audio.src = audioSrc;
    audio.play().catch(() => {});
    lastPlayedVoiceRef.current = { nodeId: currentNode.id, audioSrc };
  }, [currentNode, voiceCache]);

  const fullscreenSupported =
    typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function';
  const shouldRequireFullscreen = isTouchDevice && !isStandalone && fullscreenSupported && !allowNonFullscreen;

  const requestFullscreen = async () => {
    if (!fullscreenSupported) return false;
    if (document.fullscreenElement) return true;
    try {
      await document.documentElement.requestFullscreen();
      return true;
    } catch {
      return false;
    }
  };

  const handleStartGame = async (forceStart = false) => {
    if (!audioContextRef.current) return;
    setFullscreenError(null);

    if (shouldRequireFullscreen && !isFullScreen) {
      const ok = await requestFullscreen();
      if (!ok && !forceStart) {
        setFullscreenError('未能进入全屏：请点击“进入全屏”或在浏览器菜单中选择全屏。');
        return;
      }
      if (!ok && forceStart) {
        setAllowNonFullscreen(true);
      }
    }

    await audioContextRef.current.resume();
    setHasStarted(true);
  };

  // Background Logic
  useEffect(() => {
    if (!currentNode) return;
    if (currentNode.backgroundPrompt && assets.backgrounds[currentNode.backgroundPrompt]) {
      setCurrentBackground(assets.backgrounds[currentNode.backgroundPrompt]);
    } else if (!currentBackground && Object.keys(assets.backgrounds).length > 0) {
        setCurrentBackground(assets.backgrounds[Object.keys(assets.backgrounds)[0]]);
    }
  }, [currentNodeId, currentNode, currentBackground, assets.backgrounds]);

  // Track recent dialogue for incremental continuation
  useEffect(() => {
    if (!currentNode) return;
    setDialogueHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === String(currentNode.speaker) && last.textCN === currentNode.textCN) return prev;
      const next = [...prev, { speaker: String(currentNode.speaker), textCN: currentNode.textCN }];
      return next.length > 60 ? next.slice(-60) : next;
    });
  }, [currentNodeId, currentNode]);

  // Track navigation history for "go back to last branch choice"
  useEffect(() => {
    if (!currentNodeId) return;
    if (isRestoringHistoryRef.current) {
      isRestoringHistoryRef.current = false;
      return;
    }

    setVisitStack((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.nodeId === currentNodeId) return prev;
      return [...prev, { nodeId: currentNodeId, affinity }];
    });
  }, [currentNodeId, affinity]);

  // Notify parent when game ends (once)
  useEffect(() => {
    if (gameEnded && !endNotified) {
      setEndNotified(true);
      onGameEnd?.();
    }
  }, [gameEnded, endNotified, onGameEnd]);

  // BGM Logic (Seamless Cross-fade & Continuous Playback)
  useEffect(() => {
    if (!hasStarted || !currentNode || !audioContextRef.current) return;

    const playBgm = async (key: string) => {
        // 1. Validation
        if (!assets.music[key] && !AUDIO_LIBRARY[key]) return;

        // 2. Skip if already playing this track (Continuous Playback)
        if (currentBgmKey === key) return;

        try {
            // 3. Decode FIRST to ensure smooth transition (No gap/silence during loading)
            const cached = bgmBufferCacheRef.current[key];
            const buffer =
              cached ||
              (assets.music[key]
                ? await decodeStandardAudio(assets.music[key], audioContextRef.current!)
                : await decodeUrlAudio(AUDIO_LIBRARY[key], audioContextRef.current!));
            if (!cached) bgmBufferCacheRef.current[key] = buffer;
            
            if (audioContextRef.current?.state === 'closed') return;
            const ctx = audioContextRef.current!;
            const now = ctx.currentTime;

            // 4. Crossfade: Fade Out Old Track
            if (bgmSourceRef.current && bgmGainRef.current) {
                const oldSource = bgmSourceRef.current;
                const oldGain = bgmGainRef.current;
                
                try {
                    oldGain.gain.cancelScheduledValues(now);
                    oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                    oldGain.gain.linearRampToValueAtTime(0, now + 2); // 2s Fade out
                    
                    // Stop later to allow fade out to finish
                    setTimeout(() => { 
                        try { oldSource.stop(); oldSource.disconnect(); oldGain.disconnect(); } catch(e){} 
                    }, 2500);
                } catch (e) { console.error(e); }
            }

            // 5. Crossfade: Start New Track
            const newSource = ctx.createBufferSource();
            newSource.buffer = buffer;
            newSource.loop = true;
            
            const newGain = ctx.createGain();
            newGain.gain.value = 0; // Start silent
            
            newSource.connect(newGain);
            newGain.connect(ctx.destination);
            
            newSource.start(0);
            newGain.gain.linearRampToValueAtTime(0.5, now + 2); // 2s Fade in

            // 6. Update References & State
            bgmSourceRef.current = newSource;
            bgmGainRef.current = newGain;
            setCurrentBgmKey(key);

        } catch (e) {
            console.warn("BGM Playback failed", e);
        }
    };

    // Determine target BGM
    let targetKey = currentNode.bgm;
    
    // Logic: Music must ALWAYS play.
    if (!targetKey) {
        if (currentBgmKey) {
             // Case A: Music is already playing, and this node has no specific BGM.
             // Action: KEEP PLAYING (Do nothing). Do not pause, do not stop.
             return;
        } else {
             // Case B: No music playing yet (Start of game), and first node has no BGM.
             // Action: Play Default (bgm_bossa or first available).
             targetKey = 'bgm_bossa';
             if (!assets.music[targetKey] && !AUDIO_LIBRARY[targetKey]) {
               targetKey = Object.keys(assets.music)[0] || Object.keys(AUDIO_LIBRARY)[0];
             }
        }
    }

    if (targetKey) {
        playBgm(targetKey);
    }

  }, [currentNodeId, currentNode, assets.music, hasStarted, currentBgmKey]);

  const handleNext = () => {
    if (!currentNode) return;
    if (currentNode.nodeType === 'user_choice') return;
    if (currentNode.choices && currentNode.choices.length > 0) return;
    
    if (currentNode.nextNodeId) {
      if (runtimeScript.nodes[currentNode.nextNodeId]) {
        setCurrentNodeId(currentNode.nextNodeId);
      } else {
        // Streaming generation may still be producing the next node.
        setWaitingForNodeId(currentNode.nextNodeId);
      }
      return;
    } else {
      setGameEnded(true);
    }
  };

  const handleChoice = (choice: Choice) => {
    setAffinity(prev => Math.min(100, Math.max(0, prev + choice.affinityScore)));
    setCurrentNodeId(choice.nextNodeId);
  };

  const canGoBackToLastBranch = () => {
    if (isContinuing || waitingForNodeId) return false;
    for (let i = visitStack.length - 2; i >= 0; i--) {
      const id = visitStack[i]?.nodeId;
      if (!id) continue;
      if (runtimeScript.nodes[id]?.nodeType === 'user_choice') return true;
    }
    return false;
  };

  const goBackToLastBranch = () => {
    if (isContinuing || waitingForNodeId) return;
    let targetIndex = -1;
    for (let i = visitStack.length - 2; i >= 0; i--) {
      const id = visitStack[i]?.nodeId;
      if (!id) continue;
      if (runtimeScript.nodes[id]?.nodeType === 'user_choice') {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return;

    const entry = visitStack[targetIndex];
    isRestoringHistoryRef.current = true;
    setWaitingForNodeId(null);
    setContinueError(null);
    setIsContinuing(false);
    setContinuingChoiceIndex(null);
    setAffinity(entry.affinity);
    setCurrentNodeId(entry.nodeId);
    setVisitStack((prev) => prev.slice(0, targetIndex + 1));
  };

  const handleSaveGame = async () => {
    setIsSaving(true);
    try {
      await saveGame(runtimeScript, assetsWithVoice, userProfile, currentNodeId, affinity);
      setSaveMessage("保存成功（仅保存在本地）");
    } catch (e) {
      setSaveMessage("保存失败");
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 2000);
    }
  };

  const handlePublishToPlaza = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    setPublishMessage(null);
    try {
      const saveData: SaveFile = {
        id: Date.now(),
        title: runtimeScript.title || 'Untitled Story',
        date: new Date().toLocaleString('zh-CN'),
        heroineName: runtimeScript.heroineName,
        affinity,
        currentNodeId,
        script: runtimeScript,
        assets: assetsWithVoice,
        userProfile,
      };
      const game = await publishPlazaGame(saveData);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const url = origin ? `${origin}/g/${game.id}` : `/g/${game.id}`;
      setPublishMessage('已发布');
      setPublishLink(url);
    } catch (err: any) {
      setPublishMessage(err?.message || '上传失败');
    } finally {
      setIsPublishing(false);
      setTimeout(() => setPublishMessage(null), 3500);
    }
  };

  const addUserOptionAndStart = async () => {
    if (!enableContinue) return;
    if (!currentNode || currentNode.nodeType !== 'user_choice') return;
    const text = newOptionText.trim();
    if (!text) return;
    if (isContinuing) return;

    const choiceIndex = (currentNode.choices || []).length;
    const choiceNodeId = currentNode.id;
    const entryNodeId = `choice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const pendingNextId = `pending-${entryNodeId}`;

    setContinueError(null);
    setNewOptionText('');

    setRuntimeScript((prev) => {
      const node = prev.nodes[choiceNodeId];
      if (!node) return prev;
      const existing = node.choices ? [...node.choices] : [];
      existing.push({ text, nextNodeId: entryNodeId, affinityScore: 0 });
      return {
        ...prev,
        nodes: {
          ...prev.nodes,
          [node.id]: { ...node, choices: existing },
          [entryNodeId]: {
            id: entryNodeId,
            speaker: SpeakerType.PROTAGONIST,
            textCN: text,
            emotion: 'normal',
            backgroundPrompt: node.backgroundPrompt,
            bgm: node.bgm,
            nextNodeId: pendingNextId,
            nodeType: 'dialogue',
          },
        },
      };
    });

    try {
      await streamContinueFromChoice({ choiceText: text, choiceIndex, choiceNodeId, entryNodeId, pendingNextId });
    } catch (e: any) {
      setContinueError(e?.message || '续写失败，请重试');
      setIsContinuing(false);
      setContinuingChoiceIndex(null);
    }
  };

  const streamContinueFromChoice = async (params: {
    choiceText: string;
    choiceIndex: number;
    choiceNodeId: string;
    entryNodeId: string;
    pendingNextId: string;
  }) => {
    const { choiceText, choiceIndex, choiceNodeId, entryNodeId, pendingNextId } = params;
    setIsContinuing(true);
    setContinuingChoiceIndex(choiceIndex);
    setContinueError(null);

    try {
      const allowedBackgroundPrompts = Object.keys(assets.backgrounds);
      const heroineEmotions = ['normal', 'shy', 'happy', 'surprised'];
      const protagonistEmotions = hasProtagonist ? ['normal', 'happy', 'shy'] : heroineEmotions;
      const recentDialogue = dialogueHistory.slice(-12);

      const resp = await fetch(`${API_BASE}/api/continue-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protagonistName: userProfile.name || 'Player',
          heroineName: runtimeScript.heroineName || 'Yuki',
          userChoiceText: choiceText,
          affinity,
          allowedBackgroundPrompts,
          allowedHeroineEmotions: heroineEmotions,
          allowedProtagonistEmotions: protagonistEmotions,
          hasProtagonistSprite: hasProtagonist,
          recentDialogue,
          stream: true,
        }),
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `Request failed: ${resp.status}`);
      }
      if (!contentType.includes('application/x-ndjson') || !resp.body) {
        const text = await resp.text().catch(() => '');
        try {
          const data = JSON.parse(text);
          if (data && typeof data.error === 'string') throw new Error(data.error);
        } catch {
          // ignore
        }
        throw new Error('Streaming response missing/invalid.');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let startNodeId: string | null = null;
      let appliedAffinity = false;

      const upsertNode = (node: any) => {
        setRuntimeScript((prev) => ({
          ...prev,
          nodes: {
            ...prev.nodes,
            [node.id]: node,
          },
        }));
      };

      const patchChoiceStart = (startId: string) => {
        setRuntimeScript((prev) => {
          const entry = prev.nodes[entryNodeId];
          if (!entry) return prev;
          // Replace the placeholder next id with the real first node id.
          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [entryNodeId]: { ...entry, nextNodeId: startId },
            },
          };
        });
      };

      const patchChoiceAffinity = (delta: number) => {
        setRuntimeScript((prev) => {
          const node = prev.nodes[choiceNodeId];
          if (!node) return prev;
          const choices = node.choices ? [...node.choices] : [];
          const picked = choices[choiceIndex];
          if (!picked) return prev;
          choices[choiceIndex] = { ...picked, affinityScore: delta };
          return {
            ...prev,
            nodes: {
              ...prev.nodes,
              [node.id]: { ...node, choices },
            },
          };
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          let msg: any = null;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === 'error') {
            throw new Error(msg.error || 'Streaming error');
          }
          if (msg.type === 'affinity' && !appliedAffinity) {
            const delta = typeof msg.delta === 'number' ? msg.delta : Number(msg.delta);
            const deltaValue = Number.isFinite(delta) ? delta : 0;
            appliedAffinity = true;
            patchChoiceAffinity(deltaValue);
            setAffinity((prev) => Math.min(100, Math.max(0, prev + deltaValue)));
            continue;
          }
          if (msg.type === 'done') {
            continue;
          }
          if (msg.type === 'node' && msg.node) {
            const node = msg.node;
            if (!startNodeId) {
              startNodeId = node.id;
              upsertNode(node);
              patchChoiceStart(node.id);
              setWaitingForNodeId((prev) => (prev === pendingNextId ? node.id : prev));
              // We now have at least one real node, so we can leave the choice overlay and start playing.
              setCurrentNodeId((prev) => (prev === choiceNodeId ? entryNodeId : prev));
              continue;
            }
            upsertNode(node);
          }
        }
      }
    } finally {
      setIsContinuing(false);
      setContinuingChoiceIndex(null);
    }
  };

  const handleUserChoiceSelect = async (choice: Choice, index: number) => {
    if (!currentNode || currentNode.nodeType !== 'user_choice') return;
    if (isContinuing) return;

    if (choice.nextNodeId && runtimeScript.nodes[choice.nextNodeId]) {
      handleChoice(choice);
      return;
    }

    try {
      const choiceNodeId = currentNode.id;
      const entryNodeId = choice.nextNodeId && choice.nextNodeId.trim().length > 0 ? choice.nextNodeId : `choice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const pendingNextId = `pending-${entryNodeId}`;

      // Ensure the choice points to an in-story "player choice" node.
      setRuntimeScript((prev) => {
        const node = prev.nodes[choiceNodeId];
        if (!node) return prev;
        const choices = node.choices ? [...node.choices] : [];
        const picked = choices[index];
        if (!picked) return prev;
        choices[index] = { ...picked, nextNodeId: entryNodeId };

        const existingEntry = prev.nodes[entryNodeId];
        const nextNodes: Record<string, any> = {
          ...prev.nodes,
          [node.id]: { ...node, choices },
        };

        if (!existingEntry) {
          nextNodes[entryNodeId] = {
            id: entryNodeId,
            speaker: SpeakerType.PROTAGONIST,
            textCN: picked.text,
            emotion: 'normal',
            backgroundPrompt: node.backgroundPrompt,
            bgm: node.bgm,
            nextNodeId: pendingNextId,
            nodeType: 'dialogue',
          };
        } else if (!existingEntry.nextNodeId) {
          nextNodes[entryNodeId] = { ...existingEntry, nextNodeId: pendingNextId };
        }

        return { ...prev, nodes: nextNodes };
      });

      await streamContinueFromChoice({ choiceText: choice.text, choiceIndex: index, choiceNodeId, entryNodeId, pendingNextId });
    } catch (e: any) {
      setContinueError(e?.message || '续写失败，请重试');
    } finally {
      setIsContinuing(false);
      setContinuingChoiceIndex(null);
    }
  };

  // If we were waiting for a not-yet-streamed node, jump when it arrives.
  useEffect(() => {
    if (!waitingForNodeId) return;
    if (runtimeScript.nodes[waitingForNodeId]) {
      setCurrentNodeId(waitingForNodeId);
      setWaitingForNodeId(null);
    }
  }, [waitingForNodeId, runtimeScript]);

  // Helper for Animation Class
  const getSpriteAnimClass = (emotion: string) => {
    switch (emotion) {
      case 'happy': return 'animate-bounce-gentle';
      case 'angry': return 'animate-shake';
      case 'surprised': return 'animate-pop';
      case 'shy': return 'animate-breathe';
      default: return 'animate-breathe';
    }
  };

  if (!hasStarted) {
      return (
          <div className="relative w-full h-full flex flex-col items-center justify-center bg-gray-100 z-50">
               <div className="absolute inset-0 opacity-10 filter grayscale contrast-150">
                 {Object.values(assets.backgrounds)[0] && (
                     <img src={`data:image/png;base64,${Object.values(assets.backgrounds)[0]}`} className="w-full h-full object-cover" alt="" />
                 )}
               </div>
               <div className={`z-10 text-center space-y-4 ${d('lg:space-y-6')}`}>
                   <h2 className={`text-2xl ${d('lg:text-4xl')} font-black tracking-tighter uppercase animate-float`}>准备就绪</h2>
                   {fullscreenError && (
                     <div className="text-[10px] font-mono-tech text-red-600 max-w-xs mx-auto">
                       {fullscreenError}
                     </div>
                   )}
                   <button 
                     onClick={() => handleStartGame(false)}
                     className={`bg-black text-white px-8 py-3 ${d('lg:px-12 lg:py-4')} font-bold text-lg ${d('lg:text-xl')} uppercase tracking-widest hover:bg-white hover:text-black border-2 border-black transition-all`}
                   >
                       {shouldRequireFullscreen && !isFullScreen ? '进入全屏并开始' : '开始'}
                   </button>
                   {shouldRequireFullscreen && !isFullScreen && (
                     <button
                       onClick={() => handleStartGame(true)}
                       className="block mx-auto text-[10px] font-mono-tech text-gray-600 hover:text-black transition-colors"
                     >
                       无法全屏？仍要开始
                     </button>
                   )}
               </div>
          </div>
      );
  }

  if (gameEnded) {
    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center bg-black overflow-hidden">
         <div className="absolute inset-0 opacity-25">
           {(currentBackground || Object.values(assets.backgrounds)[0]) && (
             <img
               src={`data:image/png;base64,${currentBackground || Object.values(assets.backgrounds)[0]}`}
               className="w-full h-full object-cover"
               alt="背景"
             />
           )}
         </div>
         <div className="absolute inset-0 bg-black/55" />

         <div className={`relative z-10 bg-white/95 backdrop-blur-md p-6 ${d('lg:p-12')} border border-black shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] text-center max-w-lg animate-pop m-4`}>
            <h1 className={`text-4xl ${d('lg:text-6xl')} font-black mb-4 ${d('lg:mb-6')} uppercase`}>完</h1>
            <div className={`mb-4 ${d('lg:mb-8')} border-t border-b border-gray-200 py-4`}>
               <p className={`text-[10px] ${d('lg:text-xs')} text-gray-500 font-mono-tech mb-2`}>好感度</p>
               <div className={`text-6xl ${d('lg:text-8xl')} font-black`}>{affinity}%</div>
            </div>
            <div className="space-y-4">
                <Button onClick={handlePublishToPlaza} className="w-full" disabled={isPublishing} isTouch={isTouchDevice}>
                    {isPublishing ? "正在发布..." : "发布到嘎拉广场并复制分享链接"}
                </Button>
                {publishMessage && <p className="text-green-600 font-mono-tech text-xs">{publishMessage}</p>}
                <Button onClick={onExit} variant="secondary" className="w-full" isTouch={isTouchDevice}>返回根目录</Button>
            </div>
         </div>
      </div>
    );
  }

  if (!currentNode) return null;

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none font-sans">
      <CopyLinkModal
        open={!!publishLink}
        url={publishLink || ''}
        title="已发布：复制分享链接"
        onClose={() => setPublishLink(null)}
      />
      {shouldRequireFullscreen && !isFullScreen && (
        <div className="absolute inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6 overlay-fade-in">
          <div className="bg-white text-black max-w-md w-full border-2 border-black shadow-2xl p-5 space-y-4 modal-scale-in">
            <div className="text-lg font-black tracking-tight">需要全屏以继续游玩</div>
            <div className="text-sm text-gray-700 leading-relaxed">
              点击下方按钮进入全屏；若你的浏览器不支持，可选择继续（不推荐）。
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Button onClick={() => requestFullscreen()} className="w-full" isTouch={isTouchDevice}>
                进入全屏
              </Button>
              <Button
                onClick={() => setAllowNonFullscreen(true)}
                variant="secondary"
                className="w-full"
                isTouch={isTouchDevice}
              >
                继续（不全屏）
              </Button>
            </div>
          </div>
        </div>
      )}
      
      {/* Background with Ken Burns & Crossfade */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        {currentBackground && (
          <div key={currentBackground} className="absolute inset-0 w-full h-full animate-fade-in">
             <img 
               src={`data:image/png;base64,${currentBackground}`} 
               className="w-full h-full object-cover filter brightness-[0.85] contrast-110 animate-ken-burns origin-center" 
               alt="背景" 
             />
          </div>
        )}
      </div>

      {/* Love Meter / Stats (Z-50) */}
      <div className={`absolute top-0 left-0 z-50 p-2 ${d('lg:p-6')}`}>
         <div className={`bg-white/90 backdrop-blur-md border border-black p-1 ${d('lg:p-3')} flex items-center gap-2 ${d('lg:gap-4')} shadow-md transition-all hover:scale-105 origin-top-left scale-90 ${d('lg:scale-100')}`}>
            <div className="flex flex-col">
               <span className={`text-[8px] ${d('lg:text-[10px]')} font-mono-tech text-gray-500 uppercase`}>同步率</span>
               <span className={`text-sm ${d('lg:text-2xl')} font-black`}>{affinity}%</span>
            </div>
            <div className={`w-16 ${d('lg:w-32')} h-1 ${d('lg:h-2')} bg-gray-200 overflow-hidden`}>
               <div className="h-full bg-black transition-all duration-1000 ease-out" style={{ width: `${affinity}%` }}></div>
            </div>
         </div>
      </div>

      {/* Sprites (Z-10) - BEHIND Dialogue Box */}
      <div className={`absolute inset-0 z-10 flex items-end justify-center px-4 ${d('lg:px-20')} pb-0 pointer-events-none`}>
         
	         {/* Protagonist (Left) */}
	         {hasProtagonist && (
	           <div 
	             className={`absolute left-[2%] bottom-0 transition-all duration-500 ease-out origin-bottom
	             ${currentNode.speaker === SpeakerType.PROTAGONIST 
	               ? 'z-10 scale-100 filter-none' 
	               : 'z-0 scale-95 opacity-100'}`}
	           >
              <CrossfadeImage 
                 src={`data:image/png;base64,${assets.protagonist[currentNode.emotion as keyof typeof assets.protagonist] || assets.protagonist.normal}`} 
                 className={`h-[78vh] ${d('lg:h-[92vh]')} object-contain drop-shadow-2xl ${currentNode.speaker === SpeakerType.PROTAGONIST ? getSpriteAnimClass(currentNode.emotion) : ''}`}
                 alt="主角"
              />
           </div>
	         )}

	         {/* Heroine (Right) */}
	         <div 
	           className={`absolute bottom-0 transition-all duration-500 ease-out origin-bottom
	           ${hasProtagonist ? 'right-[2%]' : 'left-1/2 -translate-x-1/2'}
	           ${heroineActive 
	             ? 'z-10 scale-100 filter-none' 
	             : 'z-0 scale-95 opacity-100'}`}
	         >
            <CrossfadeImage 
               src={`data:image/png;base64,${assets.heroine[currentNode.emotion as keyof typeof assets.heroine] || assets.heroine.normal}`} 
               className={`h-[88vh] ${d('lg:h-[105vh]')} object-contain drop-shadow-2xl ${heroineActive ? getSpriteAnimClass(currentNode.emotion) : ''}`}
               alt="女主角"
            />
         </div>
      </div>

      {/* Choices Overlay (Z-60) */}
      {currentNode.choices && !isUserChoiceNode && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center p-4 animate-fade-in">
           <div className={`w-full max-w-xl space-y-2 ${d('lg:space-y-4')}`}>
             <div className={`text-[10px] ${d('lg:text-xs')} font-mono-tech text-white/80 mb-1 ${d('lg:mb-2')} uppercase text-center tracking-widest`}>需要选择</div>
             {currentNode.choices.map((choice, idx) => (
               <button
                 key={idx}
                 onClick={() => handleChoice(choice)}
                 className={`w-full bg-white hover:bg-black text-black hover:text-white font-bold py-2 px-3 ${d('lg:py-6 lg:px-8')} border-2 ${d('lg:border-4')} border-black shadow-[4px_4px_0px_0px_rgba(255,255,255,0.5)] ${d('lg:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.5)]')} hover:shadow-[8px_8px_0px_0px_rgba(255,255,255,1)] transition-all text-left group transform hover:translate-x-2 text-xs ${d('lg:text-base')}`}
               >
	                 <span className="mr-2 lg:mr-4 font-mono-tech text-gray-400 group-hover:text-white">0{idx + 1} {'//'}</span> {choice.text}
	               </button>
	             ))}
           </div>
        </div>
      )}

      {/* User-built Choice Overlay (Cinematic Style) */}
      {isUserChoiceNode && (
        <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center animate-fade-in">
          {/* Fullscreen Gradient Backdrop */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/60 to-black/90 backdrop-blur-[2px]" />

          {/* Cinematic Container */}
          <div className="relative w-full max-w-4xl px-8 flex flex-col items-center space-y-12 z-10">
            
            {/* Elegant Header */}
            <div className="text-center space-y-2 animate-slide-down">
               <div className="text-white/60 text-[10px] lg:text-xs font-mono-tech tracking-[0.3em] uppercase">
                 Decision Point
               </div>
               <div className="h-px w-12 bg-white/40 mx-auto" />
               <h3 className="text-2xl lg:text-4xl font-light text-white tracking-widest drop-shadow-md font-serif italic">
                 {enableContinue 
                   ? (currentNode.textCN || '抉择时刻') 
                   : '剧情节点'}
               </h3>
               {enableContinue && (
                 <p className="text-white/70 text-xs lg:text-sm font-light tracking-wide mt-2">
                   {currentNode.choices?.length === 0 ? "命运的轨迹在此分叉，请书写你的意志" : "请选择你的回应"}
                 </p>
               )}
            </div>

            {/* Input Area (Integrated HUD Style) */}
            {enableContinue && (
              <div className="w-full max-w-xl relative group animate-fade-in-up delay-100">
                <div className="relative flex items-center">
                  <span className="absolute left-0 text-white/50 text-xl font-thin pointer-events-none">
                    ➤
                  </span>
                  <input
                    value={newOptionText}
                    onChange={(e) => setNewOptionText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addUserOptionAndStart();
                      }
                    }}
                    disabled={isContinuing}
                    autoFocus
                    placeholder="输入你的回答"
                    className="w-full bg-transparent border-b border-white/30 py-3 pl-8 pr-16 text-lg lg:text-xl text-white placeholder:text-white/30 focus:border-white focus:outline-none transition-all font-light tracking-wide text-center"
                  />
                  <button
                    onClick={addUserOptionAndStart}
                    disabled={isContinuing || newOptionText.trim().length === 0}
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-white/60 hover:text-white disabled:opacity-30 transition-colors text-sm font-mono-tech tracking-widest uppercase border border-white/30 px-3 py-1 hover:border-white"
                  >
                    确认
                  </button>
                </div>
                {/* Decorative underline animation */}
                <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-white transition-all duration-500 group-focus-within:w-full" />
              </div>
            )}

            {/* Error Message */}
            {continueError && (
              <div className="text-red-400 text-xs font-mono-tech tracking-wider animate-shake">
                 [ERROR] {continueError}
              </div>
            )}

            {/* Floating Choices List */}
            <div className="w-full max-w-3xl space-y-4 lg:space-y-6 flex flex-col items-center pb-12">
              {(currentNode.choices || []).map((choice, idx) => {
                const isThisLoading = isContinuing && continuingChoiceIndex === idx;
                const canJump = !!choice.nextNodeId && !!runtimeScript.nodes[choice.nextNodeId];
                return (
                  <button
                    key={idx}
                    onClick={() => handleUserChoiceSelect(choice, idx)}
                    disabled={isContinuing && !isThisLoading}
                    className={`
                      relative group w-full lg:w-[90%] py-4 px-8 
                      flex items-center justify-center transition-all duration-300 ease-out
                      ${isThisLoading ? 'opacity-100 scale-105' : 'hover:scale-105 hover:bg-white/10'}
                    `}
                  >
                    {/* Glass Background */}
                    <div className="absolute inset-0 bg-black/40 border border-white/10 skew-x-[-12deg] group-hover:bg-black/60 group-hover:border-white/40 transition-all duration-300 backdrop-blur-sm shadow-lg" />
                    
                    {/* Active/Loading Glow */}
                    {isThisLoading && (
                       <div className="absolute inset-0 bg-white/5 border border-white/50 skew-x-[-12deg] animate-pulse" />
                    )}

                    {/* Content */}
                    <div className="relative z-10 flex items-center justify-between w-full max-w-2xl px-4">
                       {/* Number Decorative */}
                       <span className="font-mono-tech text-xs lg:text-sm text-white/30 group-hover:text-white/80 transition-colors w-8">
                         0{idx + 1}
                       </span>

                       {/* Text */}
                       <span className="flex-1 text-center text-base lg:text-xl text-white/90 font-medium tracking-wide group-hover:text-white drop-shadow-sm group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)] transition-all">
                         {choice.text}
                       </span>

                       {/* Status/Icon */}
                       <span className="w-8 flex justify-end">
                          {isThisLoading ? (
                            <span className="w-3 h-3 border border-white/60 border-t-transparent rounded-full animate-spin" />
                          ) : canJump ? (
                            <span className="text-[10px] text-white/40 font-mono-tech group-hover:text-white/80">SKIP</span>
                          ) : (
                             <span className="text-white/0 group-hover:text-white/60 transition-all text-sm transform group-hover:translate-x-1">◆</span>
                          )}
                       </span>
                    </div>

                    {/* Decorative Corner Accents (Top-Left & Bottom-Right) */}
                    <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/0 group-hover:border-white/60 transition-all duration-300 -translate-x-1 -translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0" />
                    <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/0 group-hover:border-white/60 transition-all duration-300 translate-x-1 translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0" />
                  </button>
                );
              })}
              
              {/* Empty State Prompt */}
              {(currentNode.choices || []).length === 0 && enableContinue && (
                 <div className="text-white/30 text-xs font-light tracking-widest animate-pulse mt-8">
                    AWAITING PLAYER INPUT...
                 </div>
              )}
            </div>
            
          </div>
        </div>
      )}

      {/* Streaming wait overlay */}
      {waitingForNodeId && (
        <div className="absolute inset-0 z-[65] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white/95 border-2 border-black px-4 py-3 lg:px-6 lg:py-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.35)] text-center">
            <div className="text-xs lg:text-sm font-mono-tech text-gray-700">正在生成</div>
            <div className="text-sm lg:text-base font-bold text-gray-900 mt-1">正在生成下一句…</div>
          </div>
        </div>
      )}

      {/* UI Controls (Z-60) */}
      <div className={`absolute top-0 right-0 p-2 ${d('lg:p-6')} z-[60] flex gap-2 scale-90 ${d('lg:scale-100')} origin-top-right`}>
         <Button
           variant="secondary"
           onClick={goBackToLastBranch}
           disabled={!canGoBackToLastBranch()}
           isTouch={isTouchDevice}
           className={`!px-2 !py-1 ${d('lg:!px-4 lg:!py-2')} text-[10px] ${d('lg:text-xs')} bg-white/90 backdrop-blur`}
         >
           返回
         </Button>
         <Button variant="secondary" onClick={handleSaveGame} disabled={isSaving} isTouch={isTouchDevice} className={`!px-2 !py-1 ${d('lg:!px-4 lg:!py-2')} text-[10px] ${d('lg:text-xs')} bg-white/90 backdrop-blur`}>
            {isSaving ? "保存中…" : "保存"}
         </Button>
         <Button variant="primary" onClick={onExit} isTouch={isTouchDevice} className={`!px-2 !py-1 ${d('lg:!px-4 lg:!py-2')} text-[10px] ${d('lg:text-xs')}`}>
            退出
         </Button>
      </div>
      
      {saveMessage && (
        <div className={`absolute top-12 ${d('lg:top-20')} right-6 bg-black text-white px-3 py-1 text-[10px] ${d('lg:text-xs')} font-mono-tech animate-glitch z-[70]`}>
            {saveMessage}
        </div>
      )}

      {/* Dialogue Box Container (Z-20) - ON TOP OF SPRITES */}
      {/* Positioned at absolute bottom, height determines itself based on content */}
      <div 
        className="absolute bottom-0 left-0 w-full z-20 pointer-events-auto cursor-pointer"
        onClick={handleNext}
      >
        <div className="w-full relative">
           
           {/* Name Tag - Adjusted to sit nicely above the border */}
           <div className={`absolute -top-4 left-0 ${d('lg:left-12')} bg-black text-white px-3 py-0.5 ${d('lg:px-6 lg:py-2')} text-[10px] ${d('lg:text-base')} font-bold tracking-widest uppercase transform skew-x-[-10deg] shadow-lg origin-bottom-left z-30`}>
             <div className="skew-x-[10deg]">{currentNode.speaker === SpeakerType.HEROINE ? runtimeScript.heroineName : '我'}</div>
           </div>

           {/* Text Container */}
           {/* h-auto + pb-2 means it only takes up necessary space. No fixed min-height. */}
           <div className={`w-full border-t-2 ${d('lg:border-t-4')} border-black bg-white/95 backdrop-blur-md pt-2 pb-2 px-3 ${d('lg:pt-6 lg:pb-8 lg:px-24')} relative shadow-[0_-5px_20px_rgba(0,0,0,0.2)]`}>
              <div className="w-full max-w-screen-2xl mx-auto">
                {/* Text Font Size reduced to text-sm for mobile */}
                <p className={`text-sm ${d('lg:text-3xl')} font-medium leading-tight ${d('lg:leading-relaxed')} text-gray-900`}>
                   <Typewriter text={currentNode.textCN.trim()} speed={25} />
                </p>
                {currentNode.textJP && currentNode.speaker === SpeakerType.HEROINE && (
                  <p className={`text-[9px] ${d('lg:text-base')} text-gray-500 mt-0.5 ${d('lg:mt-3')} font-mono-tech tracking-wide border-l-2 border-gray-300 pl-1 ${d('lg:pl-3')}`}>
                    {currentNode.textJP}
                  </p>
                )}
              </div>
           </div>
           
           {/* Next Indicator */}
           {!currentNode.choices && currentNode.nodeType !== 'user_choice' && (
             <div className={`absolute bottom-1 right-2 ${d('lg:bottom-4 lg:right-16')} animate-bounce text-black font-black text-sm ${d('lg:text-3xl')} opacity-50 z-50`}>
               ▼
             </div>
           )}
        </div>
      </div>
    </div>
  );
};

export default VisualNovelPlayer;
