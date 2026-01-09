import { NextRequest, NextResponse } from 'next/server';
import { generateScript, withAiDebug } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { consumeUserCoins, refundUserCoins } from '@/lib/userStore';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = (await req.json().catch(() => ({} as Record<string, any>))) as Record<string, any>;
  const { protagonistName, heroineName, plotDescription, maxMode, backgroundScenes } = payload || {};
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
    const emotionGuideRaw: Record<string, any> | null =
      payload?.emotionGuide && typeof payload.emotionGuide === 'object' ? payload.emotionGuide : null;
    const emotionGuide = emotionGuideRaw
      ? {
          heroineEmotions: Array.isArray(emotionGuideRaw.heroineEmotions) ? emotionGuideRaw.heroineEmotions : undefined,
          protagonistEmotions: Array.isArray(emotionGuideRaw.protagonistEmotions) ? emotionGuideRaw.protagonistEmotions : undefined,
          hasProtagonistSprite:
            emotionGuideRaw.hasProtagonistSprite === true ||
            emotionGuideRaw.hasProtagonistSprite === 1 ||
            emotionGuideRaw.hasProtagonistSprite === '1'
              ? true
              : emotionGuideRaw.hasProtagonistSprite === false ||
                emotionGuideRaw.hasProtagonistSprite === 0 ||
                emotionGuideRaw.hasProtagonistSprite === '0'
                ? false
                : undefined,
        }
      : undefined;
    const { result, debug } = await withAiDebug(() =>
      generateScript(
        protagonistName,
        heroineName,
        plotDescription,
        scenes.length > 0 || emotionGuide
          ? {
              ...(scenes.length > 0 ? { backgroundScenes: scenes } : {}),
              ...(emotionGuide ? { emotionGuide } : {}),
            }
          : undefined
      )
    );
    const titleFromUser =
      typeof plotDescription === 'string' && plotDescription.trim().length > 0 ? plotDescription.trim() : result.title;
    const responsePayload = { ...result, title: titleFromUser, maxMode: isMax };
    return NextResponse.json(debug ? { ...responsePayload, debug } : responsePayload);
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
