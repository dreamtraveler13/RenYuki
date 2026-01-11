'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type { PlazaGame } from '@/types';
import VisualNovelPlayer from '@/components/VisualNovelPlayer';
import { getPlazaGame } from '@/services/plazaService';

export default function SharedGamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = useMemo(() => (params?.id ? String(params.id) : ''), [params]);

  const [game, setGame] = useState<PlazaGame | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const touchCapable = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    setIsTouchDevice(touchCapable);

    const checkOrientation = () => {
      const port = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth;
      setIsPortrait(port);
    };
    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    setErrorMessage(null);
    setGame(null);
    getPlazaGame(id)
      .then((g) => setGame(g))
      .catch((err: any) => setErrorMessage(err?.message || '加载失败'));
  }, [id]);

  const forceLandscapeOnMobile = isTouchDevice && isPortrait;

  if (errorMessage) {
    return (
      <div className="w-screen h-screen h-[100dvh] h-[calc(var(--app-vh,1vh)*100)] bg-[#f7f7f8] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.10)] p-6">
          <div className="text-lg font-semibold text-gray-900">加载失败</div>
          <div className="mt-2 text-sm text-gray-600">{errorMessage}</div>
          <button
            onClick={() => router.push('/')}
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-gray-900 text-white text-sm font-semibold px-4 py-2 hover:bg-black transition-colors"
          >
            返回主页
          </button>
        </div>
      </div>
    );
  }

  if (!game) {
    return (
      <div className="w-screen h-screen h-[100dvh] h-[calc(var(--app-vh,1vh)*100)] bg-[#f7f7f8] flex items-center justify-center">
        <div className="text-sm font-mono-tech text-gray-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen h-[100dvh] h-[calc(var(--app-vh,1vh)*100)] bg-black">
      {forceLandscapeOnMobile ? (
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
            script={game.save.script}
            assets={game.save.assets}
            userProfile={game.save.userProfile}
            initialNodeId={game.save.currentNodeId}
            initialAffinity={game.save.affinity}
            onExit={() => router.push('/')}
            isTouchDevice={isTouchDevice}
            enableContinue={false}
          />
        </div>
      ) : (
        <VisualNovelPlayer
          script={game.save.script}
          assets={game.save.assets}
          userProfile={game.save.userProfile}
          initialNodeId={game.save.currentNodeId}
          initialAffinity={game.save.affinity}
          onExit={() => router.push('/')}
          isTouchDevice={isTouchDevice}
          enableContinue={false}
        />
      )}
    </div>
  );
}
