import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';
import { consumeUserCoins, refundUserCoins } from '@/lib/userStore';
import { cleanupExpiredJobsForUser, readJob } from '@/lib/gameGenerationCache';
import { createGenerationJobId, startGameGenerationJob, type StartGameGenerationInput } from '@/lib/gameGenerationWorker';
import { getGenerationQueueStatus } from '@/lib/generationQueue';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const input = (await req.json()) as StartGameGenerationInput;
  const protagonistName = typeof input?.protagonistName === 'string' ? input.protagonistName.trim() : '';
  const heroinePhotoBase64 = typeof input?.heroinePhotoBase64 === 'string' ? input.heroinePhotoBase64.trim() : '';
  if (!heroinePhotoBase64) {
    return NextResponse.json({ error: '女主照片必传' }, { status: 400 });
  }

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;

  const heroineName = typeof input?.heroineName === 'string' ? input.heroineName : '';
  const plotDescription = typeof input?.plotDescription === 'string' ? input.plotDescription : '';
  const policyRes = await enforceNoCnPoliticalSensitive({
    userId,
    inputs: [protagonistName, heroineName, plotDescription],
  });
  if (policyRes) return policyRes;

  const queueStatus = getGenerationQueueStatus();
  if (queueStatus.queued >= queueStatus.limit) {
    return NextResponse.json({ error: '服务器繁忙，请稍后再试' }, { status: 429 });
  }

  const isMax = input?.maxMode === true || input?.maxMode === 1 || input?.maxMode === '1';
  if (!isMax && input?.protagonistPhotoBase64) {
    return NextResponse.json({ error: '非 MAX 模式不能生成男主' }, { status: 400 });
  }
  const cost = isMax ? 2 : 1;
  try {
    await consumeUserCoins(userId, cost);
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
  await cleanupExpiredJobsForUser(userId);
  const started = await startGameGenerationJob({ userId, jobId, input, coinCost: cost });
  if (!started.accepted) {
    try {
      await refundUserCoins(userId, cost);
    } catch {}
    return NextResponse.json({ error: '服务器繁忙，请稍后再试' }, { status: 503 });
  }
  return NextResponse.json({ jobId });
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId') || '';
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 });

  await cleanupExpiredJobsForUser(userId);
  const record = await readJob<any>(userId, jobId);
  if (!record) return NextResponse.json({ error: '任务不存在或已过期' }, { status: 404 });

  const includeResult = searchParams.get('includeResult') === '1';
  const includeDebug = searchParams.get('includeDebug') === '1';

  const payload: any = {
    jobId: record.jobId,
    state: record.state,
    progress: record.progress,
    message: record.message,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    ...(record.error ? { jobError: record.error } : {}),
  };

  if (record.state === 'completed' && includeResult) {
    payload.result = record.result;
  }
  if ((record.state === 'completed' || record.state === 'failed') && includeDebug && Array.isArray(record.debug)) {
    payload.debug = record.debug;
  }

  return NextResponse.json(payload);
}
