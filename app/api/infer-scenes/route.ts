import { NextRequest, NextResponse } from 'next/server';
import { inferBackgroundScenes, withAiDebug } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const plotDescription = typeof payload.plotDescription === 'string' ? payload.plotDescription : '';

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;

  const policyRes = await enforceNoCnPoliticalSensitive({ userId, inputs: [plotDescription] });
  if (policyRes) return policyRes;

  try {
    const { result, debug } = await withAiDebug(() => inferBackgroundScenes(plotDescription));
    if (!Array.isArray(result) || result.length === 0) {
      return NextResponse.json({ error: '场景推测失败，请换个更具体的场景描述重试' }, { status: 422 });
    }
    return NextResponse.json(debug ? { scenes: result, debug } : { scenes: result });
  } catch (err: any) {
    console.error('infer-scenes failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to infer scenes' }, { status: 500 });
  }
}
