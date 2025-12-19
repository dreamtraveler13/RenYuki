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
    <div className="fixed inset-0 z-[23000] bg-[#f3f3f3] text-[#111] flex flex-col sheet-slide-in">
      <div className="h-14 lg:h-20 border-b border-black flex items-center justify-between px-4 lg:px-10 bg-white shrink-0">
        <div>
          <div className="text-lg lg:text-2xl font-black uppercase">嘎拉广场</div>
          <div className="hidden lg:block text-xs text-gray-500 mt-1">任何人都可以打开并游玩已发布的嘎拉</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-black/10 bg-white hover:bg-gray-50 transition-colors"
            disabled={loading}
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button
            onClick={onClose}
            className="text-2xl lg:text-4xl hover:rotate-90 transition-transform"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-10">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full lg:w-96 px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-300 bg-white"
            placeholder="搜索标题 / 女主名"
          />
          <div className="text-xs text-gray-500">{loading ? '加载中…' : `共 ${filtered.length} 条`}</div>
        </div>

        {errorMessage && (
          <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {errorMessage}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((g) => {
            const cover = g.coverBase64 ? `data:image/png;base64,${g.coverBase64}` : '';
            const busy = loadingId === g.id;
            const deleting = deletingId === g.id;
            return (
              <div key={g.id} className="rounded-2xl border border-gray-200 overflow-hidden bg-white shadow-sm">
                <div className="relative h-44 bg-gray-100">
                  {cover ? (
                    <img src={cover} className="absolute inset-0 w-full h-full object-cover" alt={g.title} />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 font-mono-tech">
                      NO_COVER
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2 text-white">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{g.title}</div>
                      <div className="text-[11px] opacity-90 truncate">
                        {g.heroineName} · {g.date}
                      </div>
                    </div>
                    <div className="text-[11px] font-mono-tech opacity-90 shrink-0">▶ {g.plays}</div>
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-600">
                    同步率 <span className="font-semibold text-gray-900">{g.affinity}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <button
                        onClick={() => remove(g.id)}
                        disabled={!!loadingId || !!deletingId}
                        className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors border ${
                          deleting
                            ? 'bg-red-50 text-red-600 border-red-200'
                            : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                        }`}
                        title="管理员删除"
                      >
                        {deleting ? '删除中…' : '删除'}
                      </button>
                    )}
                    <button
                      onClick={() => play(g.id)}
                      disabled={!!loadingId || !!deletingId}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
                        busy ? 'bg-gray-200 text-gray-500' : 'bg-gray-900 text-white hover:bg-black'
                      }`}
                    >
                      {busy ? '加载中…' : '游玩'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {!loading && filtered.length === 0 && (
            <div className="col-span-full text-center py-16 text-sm text-gray-500">暂无内容</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GalaPlazaModal;
