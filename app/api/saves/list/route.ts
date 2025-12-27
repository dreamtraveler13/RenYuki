import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { listSaves } from '@/lib/saveStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const saves = await listSaves(userId);
  return NextResponse.json(
    { saves },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
