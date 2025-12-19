import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { creditOrderIfNeeded, getOrderByOutTradeNo, markOrderPaid, toPaymentOrder } from '@/lib/orderStore';
import { epayQueryOrder, getEpayV2Config } from '@/lib/epayV2';
import { queryZpayOrder } from '@/lib/zpay';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const outTradeNo = typeof payload.outTradeNo === 'string' ? payload.outTradeNo.trim() : '';
  if (!outTradeNo) return NextResponse.json({ error: 'outTradeNo is required' }, { status: 400 });

  const order = await getOrderByOutTradeNo(outTradeNo);
  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
  if (order.userId !== userId) return NextResponse.json({ error: '无权限' }, { status: 403 });

  try {
    if (order.provider === 'epay') {
      const { pid } = getEpayV2Config();
      const result = await epayQueryOrder({ pid, out_trade_no: outTradeNo });
      const paid = Number(result?.code) === 0 && Number(result?.status) === 1;

      if (!paid) {
        return NextResponse.json({
          ok: true,
          paid: false,
          order: toPaymentOrder(order),
          upstream: { code: result?.code, status: result?.status, msg: result?.msg },
        });
      }

      await markOrderPaid({ outTradeNo, tradeNo: result.trade_no || result.api_trade_no });
      const credited = await creditOrderIfNeeded(outTradeNo);

      return NextResponse.json({
        ok: true,
        paid: true,
        order: toPaymentOrder(credited.order),
        coins: credited.coins,
        upstream: { code: result?.code, status: result?.status, msg: result?.msg },
      });
    }

    const result = await queryZpayOrder(outTradeNo);
    const paid = result?.code === 1 && Number(result?.status) === 1;

    if (!paid) {
      return NextResponse.json({
        ok: true,
        paid: false,
        order: toPaymentOrder(order),
        upstream: { code: result?.code, status: result?.status, msg: result?.msg },
      });
    }

    await markOrderPaid({ outTradeNo, tradeNo: result.trade_no });
    const credited = await creditOrderIfNeeded(outTradeNo);

    return NextResponse.json({
      ok: true,
      paid: true,
      order: toPaymentOrder(credited.order),
      coins: credited.coins,
      upstream: { code: result?.code, status: result?.status, msg: result?.msg },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '同步失败' }, { status: 500 });
  }
}
