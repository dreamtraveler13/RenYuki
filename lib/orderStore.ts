import crypto from 'crypto';
import { readDb, updateDb } from './db';
import type { ZpayPayType } from './zpay';
import type { CoinPackId, PaymentOrder } from '@/types';

export const COIN_PACKS: Record<
  CoinPackId,
  { priceYuan: string; coins: number; title: string; description: string }
> = {
  coin_2: { priceYuan: '10.00', coins: 2, title: '嘎拉币 × 2', description: '适合轻度体验' },
  coin_5: { priceYuan: '20.00', coins: 5, title: '嘎拉币 × 5', description: '更划算' },
};

export type OrderStatus = 'created' | 'paid' | 'credited';

export type ZpayOrderRecord = {
  outTradeNo: string;
  userId: string;
  provider: 'zpay';
  payType: ZpayPayType;
  packId: CoinPackId;
  amount: string; // Yuan, 2 decimals
  coins: number;
  status: OrderStatus;
  createdAt: string;
  paidAt?: string;
  creditedAt?: string;
  tradeNo?: string;
  rawNotify?: Record<string, string>;
};

export const toPaymentOrder = (order: ZpayOrderRecord): PaymentOrder => ({
  outTradeNo: order.outTradeNo,
  provider: 'zpay',
  payType: order.payType,
  packId: order.packId,
  amount: order.amount,
  coins: order.coins,
  status: order.status,
  createdAt: order.createdAt,
  paidAt: order.paidAt,
  creditedAt: order.creditedAt,
  tradeNo: order.tradeNo,
});

const generateOutTradeNo = () => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = crypto.randomInt(100, 1000); // 3 digits
  return `${yyyy}${mm}${dd}${hh}${mi}${ss}${rand}`;
};

export const getOrderByOutTradeNo = async (outTradeNo: string): Promise<ZpayOrderRecord | null> => {
  const db = await readDb();
  const order = db.orders[outTradeNo] as ZpayOrderRecord | undefined;
  return order || null;
};

export const createZpayOrder = async (params: {
  userId: string;
  packId: CoinPackId;
  payType: ZpayPayType;
}): Promise<ZpayOrderRecord> => {
  const pack = COIN_PACKS[params.packId];
  if (!pack) throw new Error('INVALID_PACK');

  return await updateDb((db) => {
    const outTradeNo = generateOutTradeNo();
    const now = new Date().toISOString();
    const order: ZpayOrderRecord = {
      outTradeNo,
      userId: params.userId,
      provider: 'zpay',
      payType: params.payType,
      packId: params.packId,
      amount: pack.priceYuan,
      coins: pack.coins,
      status: 'created',
      createdAt: now,
    };
    db.orders[outTradeNo] = order;
    return order;
  });
};

export const markOrderPaid = async (params: {
  outTradeNo: string;
  tradeNo?: string;
  rawNotify?: Record<string, string>;
}): Promise<ZpayOrderRecord> => {
  return await updateDb((db) => {
    const order = db.orders[params.outTradeNo] as ZpayOrderRecord | undefined;
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === 'created') {
      order.status = 'paid';
      order.paidAt = new Date().toISOString();
    }
    if (params.tradeNo) order.tradeNo = params.tradeNo;
    if (params.rawNotify) order.rawNotify = params.rawNotify;
    db.orders[params.outTradeNo] = order;
    return order;
  });
};

export const creditOrderIfNeeded = async (outTradeNo: string): Promise<{ order: ZpayOrderRecord; coins: number }> => {
  return await updateDb((db) => {
    const order = db.orders[outTradeNo] as ZpayOrderRecord | undefined;
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const user = db.users[order.userId] as any | undefined;
    if (!user) throw new Error('USER_NOT_FOUND');

    if (order.status === 'credited') {
      return { order, coins: Number(user.coins) || 0 };
    }

    if (order.status !== 'paid') {
      throw new Error('ORDER_NOT_PAID');
    }

    user.coins = Math.max(0, (Number(user.coins) || 0) + order.coins);
    user.updatedAt = new Date().toISOString();

    order.status = 'credited';
    order.creditedAt = new Date().toISOString();

    db.users[order.userId] = user;
    db.orders[outTradeNo] = order;

    return { order, coins: Number(user.coins) || 0 };
  });
};
