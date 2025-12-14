import { NextRequest } from 'next/server';
import { creditOrderIfNeeded, getOrderByOutTradeNo, markOrderPaid } from '@/lib/orderStore';
import { verifyZpaySignature } from '@/lib/zpay';

const readParams = async (req: NextRequest) => {
  const out: Record<string, string> = {};
  if (req.method === 'GET') {
    req.nextUrl.searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => ({} as Record<string, any>));
    Object.entries(json || {}).forEach(([k, v]) => {
      if (v == null) return;
      out[k] = String(v);
    });
    return out;
  }

  try {
    const fd = await req.formData();
    fd.forEach((v, k) => {
      out[k] = String(v);
    });
    return out;
  } catch {
    const text = await req.text().catch(() => '');
    const sp = new URLSearchParams(text);
    sp.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
};

export async function POST(req: NextRequest) {
  const params = await readParams(req);
  const outTradeNo = (params.out_trade_no || '').trim();
  const tradeStatus = (params.trade_status || '').trim();

  if (!outTradeNo) return new Response('fail', { status: 400 });
  if (!verifyZpaySignature(params)) return new Response('fail', { status: 400 });

  const order = await getOrderByOutTradeNo(outTradeNo);
  if (!order) return new Response('fail', { status: 404 });

  if (tradeStatus !== 'TRADE_SUCCESS') {
    return new Response('success', { status: 200 });
  }

  const money = (params.money || '').trim();
  if (money && order.amount && money !== order.amount) return new Response('fail', { status: 400 });

  await markOrderPaid({ outTradeNo, tradeNo: params.trade_no || params.O_id, rawNotify: params });
  await creditOrderIfNeeded(outTradeNo);

  return new Response('success', { status: 200 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}

