import { NextRequest, NextResponse } from 'next/server';
import { generateMemoryCoverImage } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';

export async function POST(req: NextRequest) {
  if (!getUserIdFromRequest(req)) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { heroineName, protagonistName, scenePrompt, affinity } = await req.json();

  if (!heroineName || !protagonistName) {
    return NextResponse.json({ error: 'heroineName and protagonistName are required' }, { status: 400 });
  }

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
