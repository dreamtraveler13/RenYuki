import { NextResponse } from 'next/server';
import { listPlazaGames } from '@/lib/plazaStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const games = await listPlazaGames();
  return NextResponse.json(
    { games },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
