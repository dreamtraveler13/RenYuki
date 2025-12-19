import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { COIN_PACKS, createOrder, createZpayOrder, toPaymentOrder } from '@/lib/orderStore';
import { epayCreateOrder, getEpayV2Config } from '@/lib/epayV2';
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
    const baseUrl = getPublicBaseUrl(req);
    const returnUrl = `${baseUrl}/pay/return`;

    const pack = COIN_PACKS[packId];
    const clientip =
      (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      (req.headers.get('x-real-ip') || '').trim() ||
      '127.0.0.1';

    const epayConfigured = (() => {
      try {
        getEpayV2Config();
        return true;
      } catch {
        return false;
      }
    })();

    if (epayConfigured) {
      const { pid } = getEpayV2Config();
      const order = await createOrder({ userId, packId, payType, provider: 'epay' });
      const notifyUrl = `${baseUrl}/api/pay/epay/notify`;
      const result = await epayCreateOrder({
        pid,
        method: 'jump',
        type: payType,
        out_trade_no: order.outTradeNo,
        notify_url: notifyUrl,
        return_url: returnUrl,
        name: `RenYuki ${pack.title}`,
        money: pack.priceYuan,
        clientip,
        param: `user:${userId};pack:${packId}`,
      });

      if (Number(result?.code) !== 0) {
        return NextResponse.json({ error: result?.msg || '创建订单失败' }, { status: 500 });
      }
      const payUrl = String(result?.pay_info || '').trim();
      if (!payUrl) return NextResponse.json({ error: '支付链接生成失败' }, { status: 500 });
      return NextResponse.json({ order: toPaymentOrder(order), payUrl });
    }

    const order = await createZpayOrder({ userId, packId, payType });
    const notifyUrl = `${baseUrl}/api/pay/zpay/notify`;
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
      msg === 'EPAY_PID_MISSING' || msg === 'EPAY_PRIVATE_KEY_MISSING' || msg === 'EPAY_PUBLIC_KEY_MISSING'
        ? '支付未配置：请在 .env.local 填写 EPAY_PID / EPAY_MCH_PRIVATE_KEY / EPAY_PLATFORM_PUBLIC_KEY'
        : msg === 'ZPAY_PID_MISSING' || msg === 'ZPAY_PKEY_MISSING'
          ? '支付未配置：请在 .env.local 填写 ZPAY_PID / ZPAY_PKEY'
        : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
