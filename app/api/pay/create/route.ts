import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { COIN_PACKS, createZpayOrder, toPaymentOrder } from '@/lib/orderStore';
import { buildZpaySubmitUrl, type ZpayPayType } from '@/lib/zpay';

const getPublicBaseUrl = (req: NextRequest) => {
  const env = (process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');

  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
};

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const packId = payload.packId as keyof typeof COIN_PACKS;
  const payType = (payload.payType as ZpayPayType) || 'alipay';

  if (!packId || !COIN_PACKS[packId]) return NextResponse.json({ error: '无效的商品' }, { status: 400 });
  if (payType !== 'alipay' && payType !== 'wxpay') return NextResponse.json({ error: '无效的支付方式' }, { status: 400 });

  try {
    const order = await createZpayOrder({ userId, packId, payType });

    const baseUrl = getPublicBaseUrl(req);
    const notifyUrl = `${baseUrl}/api/pay/zpay/notify`;
    const returnUrl = `${baseUrl}/pay/return`;

    const pack = COIN_PACKS[packId];
    const payUrl = buildZpaySubmitUrl({
      pid: process.env.ZPAY_PID || '',
      money: pack.priceYuan,
      name: `RenYuki ${pack.title}`,
      notify_url: notifyUrl,
      out_trade_no: order.outTradeNo,
      return_url: returnUrl,
      type: payType,
      param: `user:${userId};pack:${packId}`,
    });

    return NextResponse.json({ order: toPaymentOrder(order), payUrl });
  } catch (err: any) {
    const msg = err?.message || '创建订单失败';
    const friendly =
      msg === 'ZPAY_PID_MISSING' || msg === 'ZPAY_PKEY_MISSING'
        ? '支付未配置：请在 .env.local 填写 ZPAY_PID / ZPAY_PKEY'
        : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
