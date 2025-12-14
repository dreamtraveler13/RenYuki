'use client';

import React, { useMemo, useState } from 'react';
import type { AccountUser } from '../types';
import { authLogin, authRegister } from '../services/accountService';

interface Props {
  onLoggedIn: (user: AccountUser) => void;
  onEnterDevMode: () => void;
  onEnterPlazaAsGuest: () => void;
}

const LoginScreen: React.FC<Props> = ({ onLoggedIn, onEnterDevMode, onEnterPlazaAsGuest }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isValid = useMemo(() => {
    if (!username.trim()) return false;
    if (!password) return false;
    if (mode === 'register' && password.length < 6) return false;
    return true;
  }, [mode, password, username]);

  const handleSubmit = async () => {
    if (submitting || !isValid) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const user =
        mode === 'login'
          ? await authLogin({ username, password })
          : await authRegister({ username, password, displayName: displayName.trim() || undefined });
      onLoggedIn(user);
    } catch (err: any) {
      setErrorMessage(err?.message || '登录失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-[#f7f7f8] p-6">
      <div className="w-full max-w-md bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.10)] overflow-hidden">
        <div className="px-6 pt-8 pb-6">
          <div className="text-center">
            <div className="text-3xl font-semibold tracking-tight text-gray-900">RenYuki</div>
            <div className="text-sm text-gray-500 mt-1">意淫你的嘎拉</div>
          </div>

          <div className="mt-6 flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'register' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              注册
            </button>
          </div>

          <div className="mt-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-300"
                placeholder="例如：gala_user"
                autoComplete="username"
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">昵称（可选）</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-300"
                  placeholder="展示在右上角"
                  autoComplete="nickname"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">密码</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-300"
                placeholder={mode === 'register' ? '至少 6 位' : '请输入密码'}
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
              />
            </div>

            {errorMessage && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {errorMessage}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all ${
                !isValid || submitting
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-900 text-white hover:bg-black'
              }`}
            >
              {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并领取 1 个嘎拉币'}
            </button>

            <div className="text-[11px] text-gray-500 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
              新用户赠送 <span className="font-semibold text-gray-800">1</span> 个嘎拉币；创建一次消耗{' '}
              <span className="font-semibold text-gray-800">1</span> 个，MAX MODE 消耗{' '}
              <span className="font-semibold text-gray-800">2</span> 个。
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="text-[11px] text-gray-500 font-mono-tech">SYSTEM v2.0.4</div>
          <div className="flex items-center gap-3">
            <button
              onClick={onEnterPlazaAsGuest}
              className="text-[11px] text-gray-600 hover:text-gray-900 font-mono-tech underline underline-offset-4"
            >
              游客进入广场
            </button>
            <button
              onClick={onEnterDevMode}
              className="text-[11px] text-gray-600 hover:text-gray-900 font-mono-tech underline underline-offset-4"
            >
              Dev Console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
