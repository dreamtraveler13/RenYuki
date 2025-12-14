import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/authSession';
import { createUser } from '@/lib/userStore';

const toErrorMessage = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  switch (msg) {
    case 'USERNAME_REQUIRED':
      return '请输入用户名';
    case 'PASSWORD_REQUIRED':
      return '请输入密码';
    case 'PASSWORD_TOO_SHORT':
      return '密码至少 6 位';
    case 'USERNAME_TAKEN':
      return '用户名已存在';
    default:
      return '注册失败，请稍后重试';
  }
};

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const username = typeof payload.username === 'string' ? payload.username : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const displayName = typeof payload.displayName === 'string' ? payload.displayName : '';

  try {
    const user = await createUser({ username, password, displayName });
    const res = NextResponse.json({ user });
    setSessionCookie(res, user.id);
    return res;
  } catch (err) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }
}

