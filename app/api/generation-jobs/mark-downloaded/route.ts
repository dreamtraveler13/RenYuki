import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { markGenerationJobDownloaded } from '@/lib/generationJobStore';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const updated = await markGenerationJobDownloaded(userId, id);
  if (!updated) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  return NextResponse.json({ ok: true, downloadedAt: updated.downloadedAt || null });
}

