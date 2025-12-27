import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { restoreSave } from '@/lib/saveStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const save = payload?.save;
  if (!save || typeof save !== 'object') return NextResponse.json({ error: 'save is required' }, { status: 400 });

  try {
    const restored = await restoreSave(userId, save);
    return NextResponse.json({ save: restored });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'restore failed' }, { status: 500 });
  }
}
