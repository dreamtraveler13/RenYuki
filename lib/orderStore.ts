import crypto from 'crypto';
import { getDb, jsonParse, jsonStringify } from './db';
import type { CoinPackId, PayType, PaymentOrder } from '@/types';

export const COIN_PACKS: Record<
  CoinPackId,
  { priceYuan: string; coins: number; title: string; description: string }
> = {
  coin_2: { priceYuan: '10.00', coins: 2, title: '嘎拉币 × 2', description: '适合轻度体验' },
  coin_5: { priceYuan: '20.00', coins: 5, title: '嘎拉币 × 5', description: '更划算' },
};

export type OrderStatus = 'created' | 'paid' | 'credited';

export type OrderRecord = {
  outTradeNo: string;
  userId: string;
  provider: 'zpay' | 'epay';
  payType: PayType;
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

export const toPaymentOrder = (order: OrderRecord): PaymentOrder => ({
  outTradeNo: order.outTradeNo,
  provider: order.provider,
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

export const getOrderByOutTradeNo = async (outTradeNo: string): Promise<OrderRecord | null> => {
  const db = await getDb();
  const { rows } = await db.query('SELECT * FROM orders WHERE out_trade_no = $1', [outTradeNo]);
  if (!rows[0]) return null;
  return {
    outTradeNo: String(rows[0].out_trade_no),
    userId: String(rows[0].user_id),
    provider: rows[0].provider,
    payType: rows[0].pay_type,
    packId: rows[0].pack_id,
    amount: String(rows[0].amount),
    coins: Number(rows[0].coins) || 0,
    status: rows[0].status,
    createdAt: String(rows[0].created_at),
    paidAt: rows[0].paid_at ? String(rows[0].paid_at) : undefined,
    creditedAt: rows[0].credited_at ? String(rows[0].credited_at) : undefined,
    tradeNo: rows[0].trade_no ? String(rows[0].trade_no) : undefined,
    rawNotify: jsonParse<Record<string, string> | undefined>(rows[0].raw_notify, undefined),
  };
};

export const createOrder = async (params: {
  userId: string;
  packId: CoinPackId;
  payType: PayType;
  provider: 'zpay' | 'epay';
}): Promise<OrderRecord> => {
  const pack = COIN_PACKS[params.packId];
  if (!pack) throw new Error('INVALID_PACK');

  const db = await getDb();
  const outTradeNo = generateOutTradeNo();
  const now = new Date().toISOString();
  const order: OrderRecord = {
    outTradeNo,
    userId: params.userId,
    provider: params.provider,
    payType: params.payType,
    packId: params.packId,
    amount: pack.priceYuan,
    coins: pack.coins,
    status: 'created',
    createdAt: now,
  };

  await db.query(
    `
      INSERT INTO orders (
        out_trade_no, user_id, provider, pay_type, pack_id, amount, coins,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      order.outTradeNo,
      order.userId,
      order.provider,
      order.payType,
      order.packId,
      order.amount,
      order.coins,
      order.status,
      order.createdAt,
    ]
  );

  return order;
};

export const markOrderPaid = async (params: {
  outTradeNo: string;
  tradeNo?: string;
  rawNotify?: Record<string, string>;
}): Promise<OrderRecord> => {
  const db = await getDb();
  const now = new Date().toISOString();
  const { rows } = await db.query(
    `
      UPDATE orders
      SET status = CASE WHEN status = 'created' THEN 'paid' ELSE status END,
          paid_at = CASE WHEN status = 'created' THEN $2 ELSE paid_at END,
          trade_no = COALESCE($3, trade_no),
          raw_notify = COALESCE($4::jsonb, raw_notify)
      WHERE out_trade_no = $1
      RETURNING *
    `,
    [params.outTradeNo, now, params.tradeNo || null, params.rawNotify ? jsonStringify(params.rawNotify) : null]
  );
  if (!rows[0]) throw new Error('ORDER_NOT_FOUND');

  return {
    outTradeNo: String(rows[0].out_trade_no),
    userId: String(rows[0].user_id),
    provider: rows[0].provider,
    payType: rows[0].pay_type,
    packId: rows[0].pack_id,
    amount: String(rows[0].amount),
    coins: Number(rows[0].coins) || 0,
    status: rows[0].status,
    createdAt: String(rows[0].created_at),
    paidAt: rows[0].paid_at ? String(rows[0].paid_at) : undefined,
    creditedAt: rows[0].credited_at ? String(rows[0].credited_at) : undefined,
    tradeNo: rows[0].trade_no ? String(rows[0].trade_no) : undefined,
    rawNotify: jsonParse<Record<string, string> | undefined>(rows[0].raw_notify, undefined),
  };
};

export const creditOrderIfNeeded = async (outTradeNo: string): Promise<{ order: OrderRecord; coins: number }> => {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query('SELECT * FROM orders WHERE out_trade_no = $1 FOR UPDATE', [outTradeNo]);
    if (!orderRes.rows[0]) throw new Error('ORDER_NOT_FOUND');
    const orderRow = orderRes.rows[0];
    const status = orderRow.status;

    if (status === 'credited') {
      const userRes = await client.query('SELECT coins FROM users WHERE id = $1', [orderRow.user_id]);
      const coins = Number(userRes.rows[0]?.coins) || 0;
      await client.query('COMMIT');
      return {
        order: {
          outTradeNo: String(orderRow.out_trade_no),
          userId: String(orderRow.user_id),
          provider: orderRow.provider,
          payType: orderRow.pay_type,
          packId: orderRow.pack_id,
          amount: String(orderRow.amount),
          coins: Number(orderRow.coins) || 0,
          status: orderRow.status,
          createdAt: String(orderRow.created_at),
          paidAt: orderRow.paid_at ? String(orderRow.paid_at) : undefined,
          creditedAt: orderRow.credited_at ? String(orderRow.credited_at) : undefined,
          tradeNo: orderRow.trade_no ? String(orderRow.trade_no) : undefined,
          rawNotify: jsonParse<Record<string, string> | undefined>(orderRow.raw_notify, undefined),
        },
        coins,
      };
    }

    if (status !== 'paid') throw new Error('ORDER_NOT_PAID');

    const creditedAt = new Date().toISOString();
    const userUpdate = await client.query(
      `
        UPDATE users
        SET coins = coins + $2,
            updated_at = $3
        WHERE id = $1
        RETURNING coins
      `,
      [orderRow.user_id, Number(orderRow.coins) || 0, creditedAt]
    );
    if (!userUpdate.rows[0]) throw new Error('USER_NOT_FOUND');

    const orderUpdate = await client.query(
      `
        UPDATE orders
        SET status = 'credited',
            credited_at = $2
        WHERE out_trade_no = $1
        RETURNING *
      `,
      [outTradeNo, creditedAt]
    );

    await client.query('COMMIT');

    const updatedRow = orderUpdate.rows[0];
    return {
      order: {
        outTradeNo: String(updatedRow.out_trade_no),
        userId: String(updatedRow.user_id),
        provider: updatedRow.provider,
        payType: updatedRow.pay_type,
        packId: updatedRow.pack_id,
        amount: String(updatedRow.amount),
        coins: Number(updatedRow.coins) || 0,
        status: updatedRow.status,
        createdAt: String(updatedRow.created_at),
        paidAt: updatedRow.paid_at ? String(updatedRow.paid_at) : undefined,
        creditedAt: updatedRow.credited_at ? String(updatedRow.credited_at) : undefined,
        tradeNo: updatedRow.trade_no ? String(updatedRow.trade_no) : undefined,
        rawNotify: jsonParse<Record<string, string> | undefined>(updatedRow.raw_notify, undefined),
      },
      coins: Number(userUpdate.rows[0].coins) || 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Backward-compatible alias (older code paths)
export const createZpayOrder = (params: { userId: string; packId: CoinPackId; payType: PayType }) =>
  createOrder({ ...params, provider: 'zpay' });
