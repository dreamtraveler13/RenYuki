import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { publishPlazaGame } from '@/lib/plazaStore';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const save = payload.save as any;
  if (!save || typeof save !== 'object') return NextResponse.json({ error: 'save is required' }, { status: 400 });

  const sanitized = {
    ...save,
    assets: {
      ...(save.assets || {}),
      music: {},
    },
  };

  const rawSize = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
  const maxBytes = 100 * 1024 * 1024;
  if (rawSize > maxBytes) return NextResponse.json({ error: '存档太大，无法发布（>100MB）' }, { status: 413 });

  try {
    const summary = await publishPlazaGame(userId, sanitized);
    return NextResponse.json({ game: summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'publish failed' }, { status: 500 });
  }
}
