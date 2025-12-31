'use client';

import React, { useMemo, useRef, useState } from 'react';
import type { AccountUser } from '../types';
import { authLogin, authRegister } from '../services/accountService';
import Button from './Button';

interface Props {
  onLoggedIn: (user: AccountUser) => void;
  onEnterPlazaAsGuest: () => void;
}

const LoginScreen: React.FC<Props> = ({ onLoggedIn, onEnterPlazaAsGuest }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fingerprintPromiseRef = useRef<Promise<string> | null>(null);

  const isValid = useMemo(() => {
    if (!username.trim()) return false;
    if (!password) return false;
    if (mode === 'register' && password.length < 6) return false;
    return true;
  }, [mode, password, username]);

  const getFingerprint = async () => {
    if (!fingerprintPromiseRef.current) {
      fingerprintPromiseRef.current = (async () => {
        const { default: FingerprintJS } = await import('@fingerprintjs/fingerprintjs');
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        return result.visitorId;
      })();
    }
    return await fingerprintPromiseRef.current;
  };

  const handleSubmit = async () => {
    if (submitting || !isValid) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const fingerprint = await getFingerprint().catch(() => '');
      const user =
        mode === 'login'
          ? await authLogin({ username, password, ...(fingerprint ? { fingerprint } : {}) })
          : await authRegister({
              username,
              password,
              displayName: displayName.trim() || undefined,
              fingerprint: fingerprint || undefined,
            });
      onLoggedIn(user);
    } catch (err: any) {
      setErrorMessage(err?.message || '身份验证失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex items-end md:items-center justify-center bg-[#f3f3f3] md:p-6 overflow-hidden">
      {/* Decorative Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      
      {/* Card Container - Mobile: Bottom Sheet, Desktop: Center Card */}
      <div className="w-full max-w-md bg-white border-t-4 md:border-4 border-black shadow-[0_-10px_40px_rgba(0,0,0,0.1)] md:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] p-0 mobile-sheet-enter z-10 flex flex-col max-h-[90vh]">
        
        {/* Header Strip */}
        <div className="bg-black text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <div className="text-2xl font-black tracking-tighter uppercase">登录/注册</div>
            <div className="text-[10px] font-mono-tech text-gray-400">身份验证</div>
          </div>
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_#22c55e]"></div>
        </div>

        {/* Content */}
        <div className="p-6 md:p-8 space-y-6 overflow-y-auto">
          {/* Tabs */}
          <div className="flex border-b border-black/10 pb-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 pb-3 text-sm font-bold tracking-widest uppercase transition-all ${
                mode === 'login' ? 'text-black border-b-2 border-black' : 'text-gray-300 hover:text-gray-500'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 pb-3 text-sm font-bold tracking-widest uppercase transition-all ${
                mode === 'register' ? 'text-black border-b-2 border-black' : 'text-gray-300 hover:text-gray-500'
              }`}
            >
              注册
            </button>
          </div>

          <div className="space-y-5">
            <div className="group relative">
              <label className="block text-[10px] font-mono-tech text-gray-500 mb-1 uppercase tracking-wider">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-transparent border-b border-gray-300 py-2 text-lg font-bold font-mono-tech focus:border-black focus:outline-none transition-colors rounded-none placeholder:text-gray-200"
                placeholder="请输入用户名"
                autoComplete="username"
              />
              <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-black transition-all duration-500 group-focus-within:w-full"></div>
            </div>

            {mode === 'register' && (
              <div className="group relative stagger-enter stagger-1">
                <label className="block text-[10px] font-mono-tech text-gray-500 mb-1 uppercase tracking-wider">昵称 (可选)</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-transparent border-b border-gray-300 py-2 text-lg font-bold font-mono-tech focus:border-black focus:outline-none transition-colors rounded-none placeholder:text-gray-200"
                  placeholder="展示在右上角"
                  autoComplete="nickname"
                />
                <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-black transition-all duration-500 group-focus-within:w-full"></div>
              </div>
            )}

            <div className="group relative stagger-enter stagger-2">
              <label className="block text-[10px] font-mono-tech text-gray-500 mb-1 uppercase tracking-wider">密码</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent border-b border-gray-300 py-2 text-lg font-bold font-mono-tech focus:border-black focus:outline-none transition-colors rounded-none placeholder:text-gray-200"
                placeholder={mode === 'register' ? '至少6位' : '请输入密码'}
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
               <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-black transition-all duration-500 group-focus-within:w-full"></div>
            </div>
          </div>

          {errorMessage && (
            <div className="text-xs font-mono-tech text-red-600 border border-red-200 bg-red-50 p-3 stagger-enter">
              错误: {errorMessage}
            </div>
          )}

          <div className="pt-2 stagger-enter stagger-3">
            <Button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className="w-full py-4 text-base"
            >
              {submitting ? '处理中...' : mode === 'login' ? '登录' : '注册'}
            </Button>
            
            {mode === 'register' && (
               <div className="text-[10px] font-mono-tech text-gray-400 mt-2 text-center">
                 首次注册赠送 1 嘎拉币
               </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="bg-gray-50 px-6 py-4 border-t border-black/5 flex items-center justify-between shrink-0">
           <div className="text-[10px] font-mono-tech text-gray-400">RenYuki 系统</div>
           <button onClick={onEnterPlazaAsGuest} className="text-[10px] font-bold uppercase border-b border-gray-300 hover:border-black transition-colors">
              游客模式
           </button>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
