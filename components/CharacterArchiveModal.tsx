'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CharacterImages, CharacterProfile, CharacterRole } from '../types';
import Button from './Button';
import PolicyModal from './PolicyModal';
import { createProfile, deleteProfile, listProfiles, publishProfile } from '../services/profileService';
import { fileToBase64, generateHeroineSprite, generateProtagonistSprite } from '../services/aiService';
import { stripAssetBase64Map, warmUpBackgroundRemoval } from '../services/imageCutout';
import { policyAccept, policyStatus } from '../services/accountService';

interface Props {
  open: boolean;
  onClose: () => void;
  onProfilesUpdated?: () => void;
}

const normalizeProfileImages = (images: CharacterImages): CharacterImages => {
  const normal = images.normal;
  return {
    normal,
    happy: images.happy || normal,
    surprised: images.surprised || normal,
    angry: images.angry || normal,
    shy: images.shy || images.happy || normal,
    sad: images.sad || images.shy || images.happy || normal,
  };
};

const CharacterArchiveModal: React.FC<Props> = ({ open, onClose, onProfilesUpdated }) => {
  const mountedRef = useRef(true);
  const [profiles, setProfiles] = useState<CharacterProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<CharacterRole>('protagonist');
  const [nameInput, setNameInput] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>('image/jpeg');
  const [maxMode, setMaxMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [policyVersion, setPolicyVersion] = useState<number | null>(null);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const pendingCreateRef = useRef(false);

  const protagonistProfiles = useMemo(() => profiles.filter((p) => p.role === 'protagonist'), [profiles]);
  const heroineProfiles = useMemo(() => profiles.filter((p) => p.role === 'heroine'), [profiles]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshProfiles = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await listProfiles();
      if (!mountedRef.current) return;
      setProfiles(data);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setErrorMessage(err?.message || '加载失败');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    refreshProfiles();
    setNoticeMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const ensurePolicyAccepted = async () => {
    if (policyAccepted) return true;
    try {
      const status = await policyStatus();
      setPolicyVersion(status.policyVersion);
      if (!status.accepted) {
        setShowPolicyModal(true);
        return false;
      }
      setPolicyAccepted(true);
      return true;
    } catch {
      setPolicyVersion(1);
      setShowPolicyModal(true);
      return false;
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const base64 = await fileToBase64(file);
    setPhotoBase64(base64);
    setPhotoMimeType(file.type || 'image/jpeg');
  };

  const createRoleProfile = async () => {
    if (!nameInput.trim()) {
      setErrorMessage('请先填写角色名字');
      return;
    }
    if (!photoBase64) {
      setErrorMessage('请先上传角色照片');
      return;
    }

    const policyOk = await ensurePolicyAccepted();
    if (!policyOk) {
      pendingCreateRef.current = true;
      return;
    }

    setGenerating(true);
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      let images: CharacterImages;
      if (activeRole === 'protagonist') {
        if (maxMode) {
          const [normal, happy, surprised, angry] = await Promise.all([
            generateProtagonistSprite('confident smile', photoBase64, undefined, photoMimeType),
            generateProtagonistSprite('bright happy smile', photoBase64, undefined, photoMimeType),
            generateProtagonistSprite('surprised, jaw drop, shock', photoBase64, undefined, photoMimeType),
            generateProtagonistSprite('annoyed, angry, slightly frowning', photoBase64, undefined, photoMimeType),
          ]);
          images = { normal, happy, surprised, angry, shy: happy };
        } else {
          const [normal, surprised] = await Promise.all([
            generateProtagonistSprite('confident smile', photoBase64, undefined, photoMimeType),
            generateProtagonistSprite('surprised, jaw drop, shock', photoBase64, undefined, photoMimeType),
          ]);
          images = { normal, happy: normal, surprised, angry: surprised, shy: normal };
        }
      } else {
        if (maxMode) {
          const [normal, happy, shy, surprised, angry, sad] = await Promise.all([
            generateHeroineSprite('gentle smile', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('laughing happily', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('blushing shy', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('surprised, wide eyes, slight gasp', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('pouting, angry, cheeks slightly puffed', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('sad, watery eyes, holding back tears', undefined, photoBase64, photoMimeType),
          ]);
          images = { normal, happy, shy, surprised, angry, sad };
        } else {
          const [normal, happy, shy] = await Promise.all([
            generateHeroineSprite('gentle smile', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('laughing happily', undefined, photoBase64, photoMimeType),
            generateHeroineSprite('blushing shy', undefined, photoBase64, photoMimeType),
          ]);
          images = { normal, happy, shy, surprised: normal, angry: normal };
        }
      }

      const cleanedImages = normalizeProfileImages(images);
      await warmUpBackgroundRemoval();
      const transparent = await stripAssetBase64Map(cleanedImages);

      const profile = await createProfile({
        role: activeRole,
        name: nameInput.trim(),
        images: transparent,
      });

      if (!mountedRef.current) return;
      setProfiles((prev) => [profile, ...prev]);
      setNoticeMessage('角色档案已保存');
      setNameInput('');
      setPhotoBase64(null);
      setMaxMode(false);
      onProfilesUpdated?.();
    } catch (err: any) {
      if (!mountedRef.current) return;
      setErrorMessage(err?.message || '创建失败');
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  };

  const handlePublish = async (id: string) => {
    if (publishingId || deletingId) return;
    setPublishingId(id);
    setErrorMessage(null);
    setNoticeMessage(null);
    try {
      await publishProfile(id);
      setNoticeMessage('已发布到嘎拉广场');
    } catch (err: any) {
      setErrorMessage(err?.message || '发布失败');
    } finally {
      setPublishingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (publishingId || deletingId) return;
    const ok = window.confirm('确定要删除这个角色档案吗？此操作不可撤销。');
    if (!ok) return;
    setDeletingId(id);
    setErrorMessage(null);
    setNoticeMessage(null);
    try {
      await deleteProfile(id);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      onProfilesUpdated?.();
    } catch (err: any) {
      setErrorMessage(err?.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[23000] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center overlay-fade-in pointer-events-auto">
      <PolicyModal
        open={showPolicyModal}
        version={policyVersion}
        onDecline={() => {
          setShowPolicyModal(false);
          pendingCreateRef.current = false;
        }}
        onAccepted={async (version) => {
          await policyAccept({ version });
          setPolicyAccepted(true);
          setShowPolicyModal(false);
          if (pendingCreateRef.current) {
            pendingCreateRef.current = false;
            setTimeout(() => {
              createRoleProfile();
            }, 0);
          }
        }}
      />
      
      <div className="w-full h-[95vh] md:h-[90vh] md:max-w-6xl bg-[#f3f3f3] md:border-4 border-black shadow-2xl flex flex-col mobile-sheet-enter md:modal-scale-in overflow-hidden rounded-t-2xl md:rounded-none">
        
        {/* Header */}
        <div className="h-16 border-b border-black bg-white shrink-0 flex items-center justify-between px-6 z-20">
          <div className="flex flex-col">
             <div className="text-xl font-black tracking-tighter uppercase leading-none">角色档案</div>
             <div className="text-[9px] font-mono-tech text-gray-400 tracking-widest mt-1">角色数据管理</div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={refreshProfiles}
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

        <div className="flex-1 overflow-y-auto p-0 md:p-8 bg-gray-100">
          {errorMessage && (
            <div className="m-4 text-xs font-mono-tech text-red-600 bg-red-50 border border-red-200 p-3">
              错误: {errorMessage}
            </div>
          )}
          {noticeMessage && (
            <div className="m-4 text-xs font-mono-tech text-green-600 bg-green-50 border border-green-200 p-3">
              成功: {noticeMessage}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 md:gap-8 min-h-full">
            
            {/* Left Column: Create (Mobile: Top) */}
            <div className="lg:col-span-5 bg-white border-b lg:border border-black p-6 md:p-8 flex flex-col gap-6">
               <div className="flex items-center justify-between border-b-4 border-black pb-2 mb-2">
                  <h3 className="text-2xl font-black uppercase tracking-tighter">新建档案</h3>
                  <span className="font-mono-tech text-xs bg-black text-white px-2 py-0.5">写入模式</span>
               </div>

              <div className="flex items-center gap-4">
                  <button
                    onClick={() => setActiveRole('protagonist')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest border transition-all ${
                      activeRole === 'protagonist' ? 'bg-black text-white border-black' : 'bg-transparent text-gray-400 border-gray-200 hover:border-black hover:text-black'
                    }`}
                  >
                    主角
                  </button>
                  <button
                    onClick={() => setActiveRole('heroine')}
                    className={`flex-1 py-3 text-xs font-bold uppercase tracking-widest border transition-all ${
                      activeRole === 'heroine' ? 'bg-black text-white border-black' : 'bg-transparent text-gray-400 border-gray-200 hover:border-black hover:text-black'
                    }`}
                  >
                    女主
                  </button>
              </div>

              <div className="group relative">
                <label className="block text-[9px] font-mono-tech text-gray-400 mb-1 uppercase tracking-wider">名字</label>
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full bg-transparent border-b-2 border-gray-200 py-2 text-xl font-bold focus:outline-none focus:border-black transition-colors rounded-none placeholder:text-gray-200 font-mono-tech"
                  placeholder="输入名字"
                />
              </div>

              <div>
                <label className="block text-[9px] font-mono-tech text-gray-400 mb-2 uppercase tracking-wider">源图片（必填）</label>
                <div className="border border-dashed border-gray-300 hover:border-black transition-all cursor-pointer relative h-32 md:h-40 flex items-center justify-center bg-gray-50 hover:bg-white group">
                  <input type="file" accept="image/*" onChange={handleUpload} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                  {photoBase64 ? (
                    <img src={`data:${photoMimeType};base64,${photoBase64}`} className="h-full object-contain mix-blend-multiply" alt="预览" />
                  ) : (
                    <div className="text-center group-hover:scale-105 transition-transform">
                      <div className="text-xs font-bold text-gray-900 uppercase tracking-widest border border-black px-2 py-1 inline-block">上传</div>
                      <div className="text-[9px] font-mono-tech text-gray-400 mt-2">必须上传</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between gap-4">
                 <label className="flex items-center gap-2 cursor-pointer group">
                    <div className={`w-4 h-4 border transition-colors flex items-center justify-center ${maxMode ? 'bg-black border-black' : 'border-gray-300'}`}>
                        {maxMode && <div className="w-2 h-2 bg-white" />}
                    </div>
                    <input type="checkbox" checked={maxMode} onChange={e => setMaxMode(e.target.checked)} className="hidden" />
                    <span className="text-xs font-bold uppercase">MAX 表情</span>
                 </label>
                 
                 <Button onClick={createRoleProfile} disabled={generating || !photoBase64} className="flex-1">
                    {generating ? '处理中...' : '生成'}
                 </Button>
              </div>
            </div>

            {/* Right Column: List (Mobile: Bottom) */}
            <div className="lg:col-span-7 p-6 md:p-0 space-y-8">
               
               {/* Protagonists */}
               <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-black pb-1">
                      <div className="w-2 h-2 bg-black"></div>
                      <h4 className="font-mono-tech font-bold text-xs uppercase tracking-widest">主角数据</h4>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {protagonistProfiles.length === 0 && <div className="text-[10px] font-mono-tech text-gray-400 col-span-full">无数据</div>}
                      {protagonistProfiles.map(p => (
                          <div key={p.id} className="group relative border border-gray-200 bg-white hover:border-black transition-colors">
                              <div className="aspect-square bg-gray-50 p-2 overflow-hidden">
                                  <img src={`data:image/png;base64,${p.images.normal}`} className="w-full h-full object-contain mix-blend-multiply" alt={p.name} />
                              </div>
                              <div className="p-2 border-t border-gray-100">
                                  <div className="font-bold text-xs truncate uppercase">{p.name}</div>
                              </div>
                              {/* Overlay Actions */}
                              <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                  <button onClick={() => handlePublish(p.id)} className="w-full text-[9px] font-mono-tech text-white border border-white hover:bg-white hover:text-black py-1 px-2 uppercase">发布</button>
                                  <button onClick={() => handleDelete(p.id)} className="w-full text-[9px] font-mono-tech text-red-500 border border-red-500 hover:bg-red-500 hover:text-white py-1 px-2 uppercase">删除</button>
                              </div>
                          </div>
                      ))}
                  </div>
               </div>

               {/* Heroines */}
               <div className="space-y-4">
                  <div className="flex items-center gap-2 border-b border-black pb-1">
                      <div className="w-2 h-2 bg-black"></div>
                      <h4 className="font-mono-tech font-bold text-xs uppercase tracking-widest">女主数据</h4>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {heroineProfiles.length === 0 && <div className="text-[10px] font-mono-tech text-gray-400 col-span-full">无数据</div>}
                      {heroineProfiles.map(p => (
                          <div key={p.id} className="group relative border border-gray-200 bg-white hover:border-black transition-colors">
                              <div className="aspect-square bg-gray-50 p-2 overflow-hidden">
                                  <img src={`data:image/png;base64,${p.images.normal}`} className="w-full h-full object-contain mix-blend-multiply" alt={p.name} />
                              </div>
                              <div className="p-2 border-t border-gray-100">
                                  <div className="font-bold text-xs truncate uppercase">{p.name}</div>
                              </div>
                              {/* Overlay Actions */}
                              <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                                  <button onClick={() => handlePublish(p.id)} className="w-full text-[9px] font-mono-tech text-white border border-white hover:bg-white hover:text-black py-1 px-2 uppercase">发布</button>
                                  <button onClick={() => handleDelete(p.id)} className="w-full text-[9px] font-mono-tech text-red-500 border border-red-500 hover:bg-red-500 hover:text-white py-1 px-2 uppercase">删除</button>
                              </div>
                          </div>
                      ))}
                  </div>
               </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterArchiveModal;
