import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { listProfiles } from '@/lib/profileStore';

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  try {
    const profiles = await listProfiles(userId);
    return NextResponse.json({ profiles });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'load failed' }, { status: 500 });
  }
}
