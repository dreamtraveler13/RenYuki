import { NextRequest, NextResponse } from 'next/server';
import { generateSpriteSet, withAiDebug } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { emotions, userPhotoBase64, referenceImageBase64, mimeType = 'image/jpeg', isHeroine } = await req.json();
  
  if (!Array.isArray(emotions) || emotions.length === 0) {
    return NextResponse.json({ error: 'emotions array is required' }, { status: 400 });
  }
  if (!userPhotoBase64 && !referenceImageBase64) {
    return NextResponse.json({ error: '必须上传照片或提供参考图' }, { status: 400 });
  }

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;
  const policyRes = await enforceNoCnPoliticalSensitive({ userId, inputs: emotions });
  if (policyRes) return policyRes;

  try {
    const { result, debug } = await withAiDebug(() =>
      generateSpriteSet(emotions, userPhotoBase64 || referenceImageBase64, mimeType, !!isHeroine)
    );
    return NextResponse.json(debug ? { images: result, debug } : { images: result });
  } catch (err: any) {
    console.error('generate-sprites failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate sprites' }, { status: 500 });
  }
}
