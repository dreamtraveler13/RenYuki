import { NextRequest, NextResponse } from 'next/server';
import { generateMemoryCoverImage } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { heroineName, protagonistName, scenePrompt, affinity } = await req.json();

  if (!heroineName || !protagonistName) {
    return NextResponse.json({ error: 'heroineName and protagonistName are required' }, { status: 400 });
  }

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;

  const policyRes = await enforceNoCnPoliticalSensitive({
    userId,
    inputs: [heroineName, protagonistName, scenePrompt],
  });
  if (policyRes) return policyRes;

  try {
    const imageUrl = await generateMemoryCoverImage({
      heroineName,
      protagonistName,
      scenePrompt,
      affinity,
    });
    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('generate-memory-cover failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate memory cover' }, { status: 500 });
  }
}
