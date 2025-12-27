import { NextRequest, NextResponse } from 'next/server';
import { getPlazaGame, incrementPlazaPlay } from '@/lib/plazaStore';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const game = await getPlazaGame(id);
  if (!game) return NextResponse.json({ error: 'not found' }, { status: 404 });
  incrementPlazaPlay(id).catch(() => undefined);
  return NextResponse.json({ game });
}
