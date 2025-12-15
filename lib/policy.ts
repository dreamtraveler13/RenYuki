import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/authSession';
import { detectPoliticalSensitiveContent } from '@/lib/moderation';
import { recordPoliticalSensitiveStrike } from '@/lib/userStore';

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

