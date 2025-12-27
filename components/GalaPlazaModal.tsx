'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { PlazaGameSummary, SaveFile } from '../types';
import { deletePlazaGame, getPlazaGame, listPlazaGames } from '../services/plazaService';

interface Props {
  open: boolean;
  onClose: () => void;
  onPlaySave: (save: SaveFile) => void;
  isAdmin?: boolean;
}

const GalaPlazaModal: React.FC<Props> = ({ open, onClose, onPlaySave, isAdmin = false }) => {
  const [games, setGames] = useState<PlazaGameSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = () => {
    setErrorMessage(null);
    setLoading(true);
    listPlazaGames()
      .then((items) => setGames(items))
      .catch((err: any) => setErrorMessage(err?.message || '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => {
      const title = (g.title || '').toLowerCase();
      const heroine = (g.heroineName || '').toLowerCase();
      return title.includes(q) || heroine.includes(q);
    });
  }, [games, query]);

  const play = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    setErrorMessage(null);
    try {
      const game = await getPlazaGame(id);
      onPlaySave(game.save);
    } catch (err: any) {
      setErrorMessage(err?.message || '加载失败');
    } finally {
      setLoadingId(null);
    }
  };

  const remove = async (id: string) => {
    if (!isAdmin) return;
    if (deletingId || loadingId) return;
    const ok = window.confirm('确定要从嘎拉广场删除这个游戏吗？此操作不可撤销。');
    if (!ok) return;
    setDeletingId(id);
    setErrorMessage(null);
    try {
      await deletePlazaGame(id);
      setGames((prev) => prev.filter((g) => g.id !== id));
    } catch (err: any) {
      setErrorMessage(err?.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[23000] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center overlay-fade-in pointer-events-auto">
      <div className="w-full h-[92vh] md:h-[85vh] md:max-w-6xl bg-[#f3f3f3] md:border-4 border-black shadow-2xl flex flex-col mobile-sheet-enter md:modal-scale-in overflow-hidden rounded-t-2xl md:rounded-none">
        
        {/* Header */}
        <div className="h-16 border-b border-black bg-white shrink-0 flex items-center justify-between px-6 z-20">
          <div className="flex flex-col">
             <div className="text-xl font-black tracking-tighter uppercase leading-none">嘎拉广场</div>
             <div className="text-[9px] font-mono-tech text-gray-400 tracking-widest mt-1">公共档案馆</div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={refresh}
              className="text-[10px] font-bold uppercase tracking-widest hover:bg-black hover:text-white px-3 py-1 border border-transparent hover:border-black transition-all"
              disabled={loading}
            >
              {loading ? '同步中...' : '刷新'}
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center hover:bg-black hover:text-white transition-colors text-2xl leading-none font-light"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-0 md:p-8">
          
          {/* Search Bar Area */}
          <div className="sticky top-0 z-10 bg-gray-100/95 backdrop-blur border-b border-black/5 px-4 py-3 md:px-0 md:py-0 md:bg-transparent md:border-0 md:mb-6">
            <div className="flex items-center border-b-2 border-black bg-white px-4 py-3 md:max-w-md">
              <span className="text-gray-400 mr-3">🔍</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm font-bold placeholder:text-gray-300 focus:outline-none uppercase font-mono-tech"
                placeholder="搜索..."
              />
              <div className="text-[10px] font-mono-tech text-gray-400 border-l border-gray-200 pl-3">
                 {loading ? '加载中' : `共 ${filtered.length} 条`}
              </div>
            </div>
            
            {errorMessage && (
              <div className="mt-2 text-xs font-mono-tech text-red-600 bg-red-50 p-2 border border-red-200">
                错误: {errorMessage}
              </div>
            )}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-0 md:gap-6">
            {filtered.map((g, idx) => {
              const cover = g.coverBase64 ? `data:image/png;base64,${g.coverBase64}` : '';
              const busy = loadingId === g.id;
              const deleting = deletingId === g.id;
              
              return (
                <div 
                  key={g.id} 
                  className={`group bg-white border-b md:border border-gray-200 md:hover:border-black transition-all md:hover:-translate-y-1 stagger-enter`}
                  style={{ animationDelay: `${Math.min(idx * 0.05, 0.5)}s` }}
                >
                  <div className="relative h-48 md:h-56 bg-gray-200 overflow-hidden">
                    {cover ? (
                      <img 
                        src={cover} 
                        className="absolute inset-0 w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" 
                        alt={g.title} 
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 font-mono-tech bg-[url('https://www.transparenttextures.com/patterns/diagonal-striped-brick.png')] opacity-50">
                        无视觉数据
                      </div>
                    )}
                    
                    {/* Overlay Info */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
                    
                    <div className="absolute top-2 right-2 bg-black text-white text-[9px] font-mono-tech px-1.5 py-0.5">
                       同步率: {g.affinity}%
                    </div>

                    <div className="absolute bottom-3 left-3 right-3 text-white">
                      <div className="text-[10px] font-mono-tech opacity-70 mb-1">{g.date}</div>
                      <div className="text-lg font-bold leading-tight truncate uppercase tracking-wide">{g.title}</div>
                      <div className="flex items-center justify-between mt-1">
                          <div className="text-xs opacity-90 truncate max-w-[70%] font-mono-tech">
                             {g.heroineName}
                          </div>
                          <div className="text-[10px] font-mono-tech opacity-60">▶ {g.plays}</div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 flex items-center gap-2">
                    <button
                      onClick={() => play(g.id)}
                      disabled={!!loadingId || !!deletingId}
                      className={`flex-1 text-center py-2 text-xs font-bold uppercase tracking-widest border transition-all ${
                        busy 
                          ? 'bg-gray-100 text-gray-400 border-transparent' 
                          : 'bg-black text-white border-black hover:bg-white hover:text-black'
                      }`}
                    >
                      {busy ? '加载中...' : '开始游戏'}
                    </button>
                    
                    {isAdmin && (
                      <button
                        onClick={() => remove(g.id)}
                        disabled={!!loadingId || !!deletingId}
                        className="px-3 py-2 text-xs font-bold text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-500 transition-colors"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {!loading && filtered.length === 0 && (
              <div className="col-span-full py-20 text-center">
                 <div className="text-4xl text-gray-200 font-black mb-2">空</div>
                 <div className="text-xs text-gray-400 font-mono-tech">未找到任何记录</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GalaPlazaModal;
