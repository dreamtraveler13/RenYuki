'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { syncPayOrder } from '@/services/accountService';

export default function PayReturnPage() {
  const router = useRouter();
  const pendingOutTradeNo = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('renyuki_pending_order') || '';
  }, []);

  const [status, setStatus] = useState<
    | { phase: 'idle' }
    | { phase: 'syncing'; attempt: number }
    | { phase: 'paid'; coins?: number }
    | { phase: 'unpaid' }
    | { phase: 'no-order' }
    | { phase: 'auth-required' }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' });

  useEffect(() => {
    if (!pendingOutTradeNo) {
      setStatus({ phase: 'no-order' });
      return;
    }

    let canceled = false;
    const maxAttempts = 6;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const run = async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (canceled) return;
        setStatus({ phase: 'syncing', attempt });
        try {
          const resp = await syncPayOrder({ outTradeNo: pendingOutTradeNo });
          if (canceled) return;
          if (resp.paid) {
            if (typeof window !== 'undefined') localStorage.removeItem('renyuki_pending_order');
            setStatus({ phase: 'paid', coins: resp.coins });
            return;
          }
          if (attempt < maxAttempts) await sleep(1500);
        } catch (err: any) {
          const msg = String(err?.message || '');
          if (msg.includes('未登录')) {
            setStatus({ phase: 'auth-required' });
            return;
          }
          setStatus({ phase: 'error', message: msg || '同步失败' });
          return;
        }
      }
      setStatus({ phase: 'unpaid' });
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [pendingOutTradeNo]);

  return (
    <div className="w-screen h-screen h-[100dvh] h-[calc(var(--app-vh,1vh)*100)] bg-[#f7f7f8] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-black/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.10)] p-6">
        <div className="text-xl font-semibold text-gray-900">已完成支持</div>
        <div className="mt-2 text-sm text-gray-600 leading-relaxed">
          支付平台可能会有延迟。页面会自动尝试同步订单并更新余额。
        </div>

        <div className="mt-4 text-sm text-gray-700">
          {status.phase === 'syncing' && <div>正在同步订单…（第 {status.attempt} 次）</div>}
          {status.phase === 'paid' && (
            <div className="text-green-700">
              同步成功{typeof status.coins === 'number' ? `，余额已更新为 ${status.coins}` : ''}。
            </div>
          )}
          {status.phase === 'unpaid' && (
            <div className="text-gray-700">暂未查询到支付成功（可能仍在回调处理中），可稍后再试。</div>
          )}
          {status.phase === 'no-order' && (
            <div className="text-gray-700">未找到待同步订单号（可能已同步或更换设备/浏览器）。</div>
          )}
          {status.phase === 'auth-required' && (
            <div className="text-gray-700">当前浏览器未登录，无法自动同步。请返回主页登录后再同步。</div>
          )}
          {status.phase === 'error' && <div className="text-red-600">同步失败：{status.message}</div>}
        </div>

        <div className="mt-5 flex gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-gray-900 text-white text-sm font-semibold px-4 py-2 hover:bg-black transition-colors"
          >
            返回 RenYuki
          </Link>
          <button
            onClick={() => router.push('/')}
            className="inline-flex items-center justify-center rounded-xl bg-white text-gray-900 text-sm font-semibold px-4 py-2 border border-black/10 hover:border-black/30 transition-colors"
          >
            刷新主页
          </button>
        </div>

        <div className="mt-4 text-[11px] text-gray-500">如遇问题，可回到主页的“支持作者”里再次同步。</div>
      </div>
    </div>
  );
}

