import { NextResponse } from 'next/server';
import { listPlazaRoles } from '@/lib/profileStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const roles = await listPlazaRoles();
  return NextResponse.json(
    { roles },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
