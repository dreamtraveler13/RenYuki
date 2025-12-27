import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { deleteSave } from '@/lib/saveStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const id = Number(payload?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    await deleteSave(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'delete failed' }, { status: 500 });
  }
}
