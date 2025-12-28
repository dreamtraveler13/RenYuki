import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { generateHeroineTts } from '@/lib/ttsServer';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const { text, voice, languageType } = await req.json();
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const result = await generateHeroineTts({
      text,
      voice: typeof voice === 'string' ? voice : undefined,
      languageType: typeof languageType === 'string' ? languageType : undefined,
    });
    return NextResponse.json({ audioDataUrl: result.dataUrl, mimeType: result.mimeType });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'TTS failed' }, { status: 500 });
  }
}
