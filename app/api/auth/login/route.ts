import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/authSession';
import { authenticateUser } from '@/lib/userStore';
import { getUserByFingerprint, recordFingerprint } from '@/lib/fingerprintStore';

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const username = typeof payload.username === 'string' ? payload.username : '';
  const password = typeof payload.password === 'string' ? payload.password : '';
  const fingerprint = typeof payload.fingerprint === 'string' ? payload.fingerprint.trim() : '';

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

  if (fingerprint) {
    const existing = await getUserByFingerprint(fingerprint);
    if (!existing) {
      const ip =
        (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
        (req.headers.get('x-real-ip') || '').trim() ||
        '';
      const ua = req.headers.get('user-agent') || '';
      await recordFingerprint({ userId: user.id, fingerprint, ip, ua }).catch(() => {});
    }
  }

  const res = NextResponse.json({ user });
  setSessionCookie(res, user.id, req);
  return res;
}
