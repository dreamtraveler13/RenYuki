import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { acceptUserPolicy } from '@/lib/userStore';
import { POLICY_VERSION } from '@/lib/policy';

const getClientIp = (req: NextRequest) => {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded && forwarded.trim().length > 0) return forwarded.split(',')[0].trim();
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return undefined;
};

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const payload = await req.json().catch(() => ({} as Record<string, any>));
  const version = typeof payload.version === 'number' ? payload.version : Number(payload.version);
  if (!Number.isFinite(version) || version !== POLICY_VERSION) {
    return NextResponse.json({ error: '免责声明版本不匹配，请刷新页面后重试。' }, { status: 400 });
  }

  try {
    const ip = getClientIp(req);
    const ua = req.headers.get('user-agent') || undefined;
    const accepted = await acceptUserPolicy({ userId, version: POLICY_VERSION, ip, ua });
    return NextResponse.json({ ok: true, ...accepted, policyVersion: POLICY_VERSION });
  } catch (err: any) {
    const msg = err?.message || 'accept failed';
    if (msg === 'USER_BANNED') return NextResponse.json({ error: '账号已封禁' }, { status: 403 });
    if (msg === 'USER_NOT_FOUND') return NextResponse.json({ error: '未登录' }, { status: 401 });
    return NextResponse.json({ error: '提交失败，请稍后重试' }, { status: 500 });
  }
}

