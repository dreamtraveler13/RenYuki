import { NextRequest, NextResponse } from 'next/server';
import { generateProtagonist } from '@/lib/aiServer';

export async function POST(req: NextRequest) {
  const { emotion, userPhotoBase64, referenceImageBase64, mimeType = 'image/jpeg' } = await req.json();
  if (!emotion) return NextResponse.json({ error: 'emotion is required' }, { status: 400 });
  try {
    const imageUrl = await generateProtagonist(emotion, userPhotoBase64, referenceImageBase64, mimeType);
    return NextResponse.json({ imageUrl });
  } catch (err: any) {
    console.error('generate-protagonist failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate protagonist' }, { status: 500 });
  }
}
