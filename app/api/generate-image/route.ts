import { NextRequest, NextResponse } from 'next/server';
import { generateBackgroundImage } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { prompt } = await req.json();
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;
  const policyRes = await enforceNoCnPoliticalSensitive({ userId, inputs: [prompt] });
  if (policyRes) return policyRes;
  try {
    const imageUrl = await generateBackgroundImage(prompt);
    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('generate-image failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate image' }, { status: 500 });
  }
}
