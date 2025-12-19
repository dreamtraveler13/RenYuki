import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/authSession';
import { authenticateUser } from '@/lib/userStore';

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const username = typeof payload.username === 'string' ? payload.username : '';
  const password = typeof payload.password === 'string' ? payload.password : '';

  let user = null;
  try {
    user = await authenticateUser({ username, password });
  } catch (err: any) {
    if (err?.message === 'USER_BANNED') {
      return NextResponse.json({ error: '账号已封禁' }, { status: 403 });
    }
    throw err;
  }
  if (!user) return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });

  const res = NextResponse.json({ user });
  setSessionCookie(res, user.id, req);
  return res;
}
