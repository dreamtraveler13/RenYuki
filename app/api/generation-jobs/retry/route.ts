import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { consumeUserCoins } from '@/lib/userStore';
import { createGenerationJobId, startGameGenerationJob } from '@/lib/gameGenerationWorker';
import { getGenerationJobRecord } from '@/lib/generationJobStore';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const job = await getGenerationJobRecord(userId, id);
  if (!job) return NextResponse.json({ error: '任务不存在或已过期' }, { status: 404 });
  if (job.status !== 'failed' && job.status !== 'expired') {
    return NextResponse.json({ error: '当前任务无法重试' }, { status: 400 });
  }
  if (!job.input || typeof job.input !== 'object') {
    return NextResponse.json({ error: '任务数据丢失，无法重试' }, { status: 400 });
  }

  const cost = Number(job.coinCost) || 0;
  try {
    if (cost > 0) {
      await consumeUserCoins(userId, cost);
    }
  } catch (err: any) {
    const msg = err?.message || 'consume failed';
    if (msg === 'INSUFFICIENT_COINS') {
      return NextResponse.json({ error: '嘎拉币不足，请先购买（INSUFFICIENT_COINS）' }, { status: 402 });
    }
    if (msg === 'USER_NOT_FOUND') return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (msg === 'USER_BANNED') return NextResponse.json({ error: '账号已封禁' }, { status: 403 });
    return NextResponse.json({ error: '扣费失败，请稍后重试' }, { status: 500 });
  }

  const jobId = createGenerationJobId();
  const started = await startGameGenerationJob({ userId, jobId, input: job.input, coinCost: cost });
  if (!started.accepted) {
    return NextResponse.json({ error: '服务器繁忙，请稍后再试' }, { status: 503 });
  }

  return NextResponse.json({ jobId });
}
