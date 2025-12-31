import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/authSession';
import { listPlazaGames, listPlazaGamesByUser } from '@/lib/plazaStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mine = searchParams.get('mine') === '1';
  let games = [];
  if (mine) {
    const userId = getUserIdFromRequest(req);
    if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });
    games = await listPlazaGamesByUser(userId);
  } else {
    games = await listPlazaGames();
  }
  return NextResponse.json(
    { games },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
