import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/authSession';
import { createUser, deleteUserById } from '@/lib/userStore';
import { getUserByFingerprint, recordFingerprint } from '@/lib/fingerprintStore';

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
  const fingerprint = typeof payload.fingerprint === 'string' ? payload.fingerprint.trim() : '';
  if (fingerprint) {
    const existing = await getUserByFingerprint(fingerprint);
    if (existing) {
      if (existing.bannedAt) {
        return NextResponse.json({ error: '账号已封禁' }, { status: 403 });
      }
      const res = NextResponse.json({ user: existing, autoLogin: true });
      setSessionCookie(res, existing.id, req);
      return res;
    }
  }

  try {
    const user = await createUser({ username, password, displayName });
    const ip =
      (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
      (req.headers.get('x-real-ip') || '').trim() ||
      '';
    const ua = req.headers.get('user-agent') || '';
    if (fingerprint) {
      const record = await recordFingerprint({ userId: user.id, fingerprint, ip, ua });
      if (!record.inserted) {
        const fallback = await getUserByFingerprint(fingerprint);
        if (fallback) {
          if (fallback.bannedAt) {
            await deleteUserById(user.id);
            return NextResponse.json({ error: '账号已封禁' }, { status: 403 });
          }
          await deleteUserById(user.id);
          const res = NextResponse.json({ user: fallback, autoLogin: true });
          setSessionCookie(res, fallback.id, req);
          return res;
        }
      }
    }
    const res = NextResponse.json({ user });
    setSessionCookie(res, user.id, req);
    return res;
  } catch (err) {
    return NextResponse.json({ error: toErrorMessage(err) }, { status: 400 });
  }
}
