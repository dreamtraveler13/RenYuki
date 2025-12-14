import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { getUserCoins } from '@/lib/userStore';

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const coins = await getUserCoins(userId);
  return NextResponse.json({ coins });
}

