import { NextRequest, NextResponse } from 'next/server';
import { generateScript, withAiDebug } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { consumeUserCoins, refundUserCoins } from '@/lib/userStore';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { protagonistName, heroineName, plotDescription, maxMode, backgroundScenes } = await req.json();
  if (!protagonistName) return NextResponse.json({ error: 'protagonistName is required' }, { status: 400 });

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;

  const policyRes = await enforceNoCnPoliticalSensitive({
    userId,
    inputs: [protagonistName, heroineName, plotDescription],
  });
  if (policyRes) return policyRes;

  const isMax = maxMode === true || maxMode === 1 || maxMode === '1';
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

  try {
    const scenes = Array.isArray(backgroundScenes)
      ? backgroundScenes
          .filter((s: any) => s && typeof s === 'object')
          .map((s: any) => ({
            name: typeof s.name === 'string' ? s.name : typeof s.title === 'string' ? s.title : '',
            prompt: typeof s.prompt === 'string' ? s.prompt : typeof s.description === 'string' ? s.description : '',
          }))
          .filter((s: any) => typeof s.name === 'string' && s.name.trim().length > 0)
          .slice(0, 3)
      : [];
    const { result, debug } = await withAiDebug(() =>
      generateScript(
        protagonistName,
        heroineName,
        plotDescription,
        scenes.length > 0 ? { backgroundScenes: scenes } : undefined
      )
    );
    const titleFromUser =
      typeof plotDescription === 'string' && plotDescription.trim().length > 0 ? plotDescription.trim() : result.title;
    const payload = { ...result, title: titleFromUser };
    return NextResponse.json(debug ? { ...payload, debug } : payload);
  } catch (err: any) {
    console.error('generate-script failed', err);
    try {
      await refundUserCoins(userId, cost);
    } catch (refundErr) {
      console.error('refund coins failed', refundErr);
    }
    return NextResponse.json({ error: err?.message || 'Failed to generate script' }, { status: 500 });
  }
}
