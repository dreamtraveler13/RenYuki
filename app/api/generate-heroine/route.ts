import { NextRequest, NextResponse } from 'next/server';
import { generateHeroine } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';

export async function POST(req: NextRequest) {
  if (!getUserIdFromRequest(req)) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { emotion, referenceImageBase64, userPhotoBase64, mimeType = 'image/jpeg' } = await req.json();
  if (!emotion) return NextResponse.json({ error: 'emotion is required' }, { status: 400 });
  try {
    const imageUrl = await generateHeroine(emotion, referenceImageBase64, userPhotoBase64, mimeType);
    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('generate-heroine failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate heroine' }, { status: 500 });
  }
}
