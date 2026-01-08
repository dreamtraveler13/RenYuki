import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { createSave } from '@/lib/saveStore';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const { script, assets, userProfile, currentNodeId, affinity } = payload || {};
  if (!script || !assets || !userProfile || !currentNodeId) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  try {
    const save = await createSave({
      userId,
      script,
      assets,
      userProfile,
      currentNodeId,
      affinity: typeof affinity === 'number' ? affinity : Number(affinity) || 0,
    });
    return NextResponse.json({ save });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'save failed' }, { status: 500 });
  }
}
