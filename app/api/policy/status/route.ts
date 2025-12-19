import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { getUserPolicyAcceptance } from '@/lib/userStore';
import { POLICY_VERSION } from '@/lib/policy';

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const status = await getUserPolicyAcceptance(userId);
  if (!status) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (status.bannedAt) return NextResponse.json({ error: '账号已封禁' }, { status: 403 });

  const accepted = !!status.acceptedAt && status.version === POLICY_VERSION;
  return NextResponse.json({
    accepted,
    policyVersion: POLICY_VERSION,
    acceptedAt: status.acceptedAt || null,
  });
}

