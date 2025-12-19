import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/authSession';
import { detectPoliticalSensitiveContent } from '@/lib/moderation';
import { getUserPolicyAcceptance, recordPoliticalSensitiveStrike } from '@/lib/userStore';

export const POLICY_VERSION = 1;

export const enforceNoCnPoliticalSensitive = async (params: {
  userId: string;
  inputs: unknown[];
}) => {
  const hit = detectPoliticalSensitiveContent(params.inputs);
  if (!hit) return null;

  const { strikes, banned } = await recordPoliticalSensitiveStrike(params.userId, hit.matched);
  if (banned) {
    const res = NextResponse.json(
      { error: '因多次尝试生成政治敏感内容，账号已封禁。' },
      { status: 403 }
    );
    clearSessionCookie(res);
    return res;
  }

  const remaining = Math.max(0, 3 - strikes);
  return NextResponse.json(
    {
      error: `检测到政治敏感内容，已记录警告（${strikes}/3）。请勿尝试生成相关内容；再触发 ${remaining} 次将封号。`,
    },
    { status: 400 }
  );
};

export const enforcePolicyAccepted = async (params: { userId: string }) => {
  const status = await getUserPolicyAcceptance(params.userId);
  if (!status) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (status.bannedAt) {
    const res = NextResponse.json({ error: '账号已封禁' }, { status: 403 });
    clearSessionCookie(res);
    return res;
  }
  if (!status.acceptedAt || status.version !== POLICY_VERSION) {
    return NextResponse.json(
      { error: '请先阅读并同意免责声明后再生成。', policyRequired: true, policyVersion: POLICY_VERSION },
      { status: 428 }
    );
  }
  return null;
};
