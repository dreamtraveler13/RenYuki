import { NextResponse } from 'next/server';
import { listPlazaGames } from '@/lib/plazaStore';

export async function GET() {
  const games = await listPlazaGames();
  return NextResponse.json({ games });
}

