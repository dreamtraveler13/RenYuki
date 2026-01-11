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
  { id: 'coin_2', title: '支持并获赠 2 嘎拉币', subtitle: '¥10 / 支持作者', priceLabel: '¥10' },
  { id: 'coin_5', title: '支持并获赠 5 嘎拉币', subtitle: '¥20 / 获赠更多', priceLabel: '¥20' },
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
    <div className="fixed inset-0 z-[22000] bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center overlay-fade-in pointer-events-auto">
      <div className="w-full max-w-xl bg-white md:border-4 border-t-4 border-black shadow-[0_-10px_40px_rgba(0,0,0,0.2)] md:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] overflow-hidden mobile-sheet-enter md:modal-scale-in">
        
                {/* Header */}
        
                <div className="px-6 py-5 border-b border-black flex items-center justify-between bg-gray-50">
        
                  <div>
        
                    <div className="text-lg font-black uppercase tracking-tight">支持作者</div>
        
                    <div className="text-xs font-mono-tech text-gray-500 mt-0.5">剩余点数: {coins}</div>
        
                  </div>
        
                  <button
        
                    onClick={close}
        
                    className="w-8 h-8 flex items-center justify-center border border-transparent hover:border-black hover:bg-black hover:text-white transition-all text-xl leading-none"
        
                    aria-label="关闭"
        
                  >
        
                    ×
        
                  </button>
        
                </div>
        
        
        
                <div className="px-6 py-6 bg-white">
        
                  <div className="flex items-center gap-0 border border-black w-fit mb-6">
        
                    <button
        
                      onClick={() => setPayType('alipay')}
        
                      className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${
        
                        payType === 'alipay' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:text-black'
        
                      }`}
        
                    >
        
                      支付宝
        
                    </button>
        
                    <div className="w-px h-full bg-black"></div>
        
                    <button
        
                      onClick={() => setPayType('wxpay')}
        
                      className={`px-4 py-2 text-xs font-bold uppercase transition-colors ${
        
                        payType === 'wxpay' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:text-black'
        
                      }`}
        
                    >
        
                      微信
        
                    </button>
        
                  </div>
        
        
        
                  <div className="grid grid-cols-1 gap-3">
        
                    {PACKS.map((p) => (
        
                      <button
        
                        key={p.id}
        
                        onClick={() => create(p.id)}
        
                        disabled={creating}
        
                        className="group relative text-left border border-gray-300 hover:border-black transition-all p-4 active:bg-gray-50"
        
                      >
        
                        <div className="flex items-start justify-between relative z-10">
        
                          <div>
        
                            <div className="text-sm font-bold uppercase tracking-wide group-hover:underline decoration-2 underline-offset-4">{p.title}</div>
        
                            <div className="text-[10px] font-mono-tech text-gray-400 mt-1">{p.subtitle}</div>
        
                          </div>
        
                          <div className="text-lg font-black font-mono-tech">{p.priceLabel}</div>
        
                        </div>
        
                        {/* Tech Deco */}
        
                        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-black opacity-0 group-hover:opacity-100 transition-opacity" />
        
                        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-black opacity-0 group-hover:opacity-100 transition-opacity" />
        
                      </button>
        
                    ))}
        
                  </div>
                  
                  <div className="mt-2 text-[10px] font-mono-tech text-gray-400">
                    嘎拉币用于体验生成内容，为公测支持性质
                  </div>
        
        
        
                  {errorMessage && (
        
                    <div className="mt-4 text-xs font-mono-tech text-red-600 border border-red-200 bg-red-50 p-3">
        
                      错误: {errorMessage}
        
                    </div>
        
                  )}
        
        
        
                  {(order || pendingOutTradeNo) && (
        
                    <div className="mt-6 border-t-2 border-black pt-4 border-dashed">
        
                      <div className="flex flex-col gap-3">
        
                        <div>
        
                          <div className="text-[9px] font-mono-tech text-gray-400 uppercase">订单号</div>
        
                          <div className="text-xs font-mono-tech font-bold break-all bg-gray-100 p-1 mt-1">{effectiveOrderId}</div>
        
                          <div className="text-[10px] text-gray-500 mt-1">
        
                            状态: {order ? order.status.toUpperCase() : '已创建'}
        
                          </div>
        
                        </div>
        
                        <div className="grid grid-cols-2 gap-3 mt-2">
        
                          <a
        
                            href={payUrl || '#'}
        
                            target="_blank"
        
                            rel="noreferrer"
        
                            className={`flex items-center justify-center border border-black text-xs font-bold uppercase py-3 transition-colors ${
        
                              payUrl ? 'bg-black text-white hover:bg-gray-800' : 'bg-gray-100 text-gray-400 pointer-events-none border-gray-200'
        
                            }`}
        
                          >
        
                            立即支付
        
                          </a>
        
                          <button
        
                            onClick={() => sync(effectiveOrderId)}
        
                            disabled={syncing}
        
                            className={`flex items-center justify-center border border-black text-xs font-bold uppercase py-3 transition-colors ${
        
                              syncing ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-black hover:text-white'
        
                            }`}
        
                          >
        
                            {syncing ? '同步中...' : '同步状态'}
        
                          </button>
        
                        </div>
        
                      </div>
        
                    </div>
        
                  )}
        
        
        
                  <div className="mt-6 text-[9px] font-mono-tech text-gray-400 leading-relaxed border-t border-gray-100 pt-3">
        
                    提示: 支付回调可能有延迟。如果硬币没有立即出现，请等待10-30秒，然后点击“同步状态”。
        
                  </div>
        
                </div>
        
              </div>
        
            </div>
        
          );
        
        };
        
        
        
        export default BuyCoinsModal;
        
        