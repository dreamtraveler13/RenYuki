import { NextRequest, NextResponse } from 'next/server';
import { generateScript } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { consumeUserCoins, refundUserCoins } from '@/lib/userStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));

  const protagonistName = (payload.protagonistName as string) || 'Player';
  const heroineName = (payload.heroineName as string) || 'Yuki';
  const plotDescription = payload.plotDescription as string | undefined;
  const isMax = payload.maxMode === true || payload.maxMode === 1 || payload.maxMode === '1';
  const cost = isMax ? 2 : 1;

  try {
    await consumeUserCoins(userId, cost);
  } catch (err: any) {
    const msg = err?.message || 'consume failed';
    if (msg === 'INSUFFICIENT_COINS') {
      return NextResponse.json({ error: '嘎拉币不足，请先购买（INSUFFICIENT_COINS）' }, { status: 402 });
    }
    if (msg === 'USER_NOT_FOUND') return NextResponse.json({ error: '未登录' }, { status: 401 });
    return NextResponse.json({ error: '扣费失败，请稍后重试' }, { status: 500 });
  }

  try {
    const script = await generateScript(protagonistName, heroineName, plotDescription);
    const jsonString = JSON.stringify({ generatedAt: new Date().toISOString(), script }, null, 2);

    return new NextResponse(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="galgame-${Date.now()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    try {
      await refundUserCoins(userId, cost);
    } catch (refundErr) {
      console.error('refund coins failed', refundErr);
    }
    return NextResponse.json({ error: err?.message || 'generation failed' }, { status: 500 });
  }
}
