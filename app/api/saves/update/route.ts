import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { updateSaveAssets } from '@/lib/saveStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const rawId = payload?.id;
  const id = typeof rawId === 'number' ? rawId : Number(rawId);
  const assets = payload?.assets;
  const memoryCoverBase64 = payload?.memoryCoverBase64;

  if (!Number.isFinite(id) || !assets) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    const save = await updateSaveAssets(userId, id, assets, memoryCoverBase64);
    if (!save) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ save });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'update failed' }, { status: 500 });
  }
}
