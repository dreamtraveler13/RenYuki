import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'TTS is temporarily disabled.' }, { status: 410 });
}
