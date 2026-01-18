import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { createGameFeedback } from '@/lib/feedbackStore';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const content = typeof payload?.content === 'string' ? payload.content.trim() : '';

  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });

  try {
    await createGameFeedback({ userId, content });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'submit failed' }, { status: 500 });
  }
}
