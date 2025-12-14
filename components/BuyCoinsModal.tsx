'use client';

import React, { useEffect, useState } from 'react';
import type { CoinPackId, PayType, PaymentOrder } from '../types';
import { createPayOrder, syncPayOrder } from '../services/accountService';

const PACKS: Array<{
  id: CoinPackId;
  title: string;
  subtitle: string;
  priceLabel: string;
}> = [
  { id: 'coin_2', title: '嘎拉币 × 2', subtitle: '¥10 / 2 枚', priceLabel: '¥10' },
  { id: 'coin_5', title: '嘎拉币 × 5', subtitle: '¥20 / 5 枚', priceLabel: '¥20' },
];

const PENDING_ORDER_KEY = 'renyuki_pending_order';

interface Props {
  open: boolean;
  coins: number;
  onClose: () => void;
  onCoinsUpdated: (coins: number) => void;
}

const BuyCoinsModal: React.FC<Props> = ({ open, coins, onClose, onCoinsUpdated }) => {
  const [payType, setPayType] = useState<PayType>('alipay');
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [payUrl, setPayUrl] = useState<string>('');

  const [pendingOutTradeNo, setPendingOutTradeNo] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    if (typeof window !== 'undefined') setPendingOutTradeNo(localStorage.getItem(PENDING_ORDER_KEY) || '');
  }, [open]);

  const reset = () => {
    setCreating(false);
    setSyncing(false);
    setErrorMessage(null);
    setOrder(null);
    setPayUrl('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const create = async (packId: CoinPackId) => {
    if (creating) return;
    setCreating(true);
    setErrorMessage(null);
    try {
      const resp = await createPayOrder({ packId, payType });
      setOrder(resp.order);
      setPayUrl(resp.payUrl);
      if (typeof window !== 'undefined') localStorage.setItem(PENDING_ORDER_KEY, resp.order.outTradeNo);
      setPendingOutTradeNo(resp.order.outTradeNo);
    } catch (err: any) {
      setErrorMessage(err?.message || '创建订单失败');
    } finally {
      setCreating(false);
    }
  };

  const sync = async (outTradeNo: string) => {
    if (syncing) return;
    setSyncing(true);
    setErrorMessage(null);
    try {
      const resp = await syncPayOrder({ outTradeNo });
      setOrder(resp.order);
      if (resp.paid && typeof resp.coins === 'number') {
        onCoinsUpdated(resp.coins);
        if (typeof window !== 'undefined') localStorage.removeItem(PENDING_ORDER_KEY);
        setPendingOutTradeNo('');
      } else if (!resp.paid) {
        setErrorMessage('暂未查询到支付成功，请稍后再试');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  if (!open) return null;

  const effectiveOrderId = order?.outTradeNo || pendingOutTradeNo;

  return (
    <div className="fixed inset-0 z-[22000] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 overlay-fade-in">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-black/10 shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden modal-scale-in">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-gray-900">购买嘎拉币</div>
            <div className="text-xs text-gray-500 mt-0.5">当前余额：{coins} 枚</div>
          </div>
          <button
            onClick={close}
            className="h-9 w-9 rounded-xl hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-5">
          <div className="flex items-center gap-2 bg-gray-100 rounded-xl p-1 w-fit">
            <button
              onClick={() => setPayType('alipay')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                payType === 'alipay' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              支付宝
            </button>
            <button
              onClick={() => setPayType('wxpay')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                payType === 'wxpay' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              微信
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PACKS.map((p) => (
              <button
                key={p.id}
                onClick={() => create(p.id)}
                disabled={creating}
                className="group text-left rounded-2xl border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all p-4"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                    <div className="text-xs text-gray-500 mt-1">{p.subtitle}</div>
                  </div>
                  <div className="text-sm font-semibold text-gray-900">{p.priceLabel}</div>
                </div>
                <div className="mt-3 text-[11px] text-gray-500">点击生成订单 → 前往支付 → 支付完成后同步到账</div>
              </button>
            ))}
          </div>

          {errorMessage && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              {errorMessage}
            </div>
          )}

          {(order || pendingOutTradeNo) && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-gray-600">订单号</div>
                  <div className="text-sm font-mono-tech text-gray-900 break-all">{effectiveOrderId}</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    状态：{order ? order.status : 'created'}（如已支付，请点击“同步到账”）
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <a
                    href={payUrl || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className={`text-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                      payUrl ? 'bg-gray-900 text-white hover:bg-black' : 'bg-gray-200 text-gray-500 pointer-events-none'
                    }`}
                  >
                    前往支付
                  </a>
                  <button
                    onClick={() => sync(effectiveOrderId)}
                    disabled={syncing}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                      syncing ? 'bg-gray-200 text-gray-500 cursor-not-allowed' : 'bg-white text-gray-900 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {syncing ? '同步中…' : '同步到账'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 text-[11px] text-gray-500 leading-relaxed">
            提示：若支付完成后未即时到账，可稍等 10–30 秒再点一次“同步到账”（平台回调/查询可能有延迟）。
          </div>
        </div>
      </div>
    </div>
  );
};

export default BuyCoinsModal;
