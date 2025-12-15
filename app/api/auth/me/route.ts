import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { clearSessionCookie } from '@/lib/authSession';
import { getUserRecordById, getUserById } from '@/lib/userStore';

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const record = await getUserRecordById(userId);
  if (record?.bannedAt) {
    const res = NextResponse.json({ error: '账号已封禁' }, { status: 403 });
    clearSessionCookie(res);
    return res;
  }
  const user = await getUserById(userId);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  return NextResponse.json({ user });
}
