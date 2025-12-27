import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { isGodUserId, requireAdminTokenIfConfigured } from '@/lib/admin';
import { deletePlazaGame } from '@/lib/plazaStore';

export const runtime = 'nodejs';

const isValidId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const isAdmin = await isGodUserId(userId);
  if (!isAdmin) return NextResponse.json({ error: '无权限' }, { status: 403 });

  try {
    requireAdminTokenIfConfigured(req.headers);
  } catch (err: any) {
    if (err?.message === 'ADMIN_TOKEN_REQUIRED') {
      return NextResponse.json({ error: '需要管理员令牌' }, { status: 403 });
    }
    return NextResponse.json({ error: '鉴权失败' }, { status: 403 });
  }

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id || !isValidId(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  try {
    await deletePlazaGame(id);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'delete failed' }, { status: 500 });
  }
}
