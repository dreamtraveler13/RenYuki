import { NextRequest, NextResponse } from 'next/server';
import { generateScript } from '@/lib/aiServer';
import { enforceDailyGenerationLimit } from '@/lib/dailyLimit';

export async function POST(req: NextRequest) {
  const limit = enforceDailyGenerationLimit(req);
  if (limit.blocked) return limit.response;

  const { protagonistName, heroineName, plotDescription } = await req.json();
  if (!protagonistName) return NextResponse.json({ error: 'protagonistName is required' }, { status: 400 });
  try {
    const data = await generateScript(protagonistName, heroineName, plotDescription);
    const res = NextResponse.json(data);
    if (limit.cookieToSet && limit.cookieName) {
      res.cookies.set(limit.cookieName, limit.cookieToSet, { path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true });
    }
    return res;
  } catch (err: any) {
    console.error('generate-script failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate script' }, { status: 500 });
  }
}
