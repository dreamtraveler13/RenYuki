import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { publishProfileToPlaza } from '@/lib/profileStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    const role = await publishProfileToPlaza(userId, id);
    return NextResponse.json({ role });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'publish failed' }, { status: 500 });
  }
}
