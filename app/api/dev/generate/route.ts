import { NextRequest, NextResponse } from 'next/server';
import { generateScript } from '@/lib/aiServer';
import { enforceDailyGenerationLimit } from '@/lib/dailyLimit';

export async function POST(req: NextRequest) {
  const limit = enforceDailyGenerationLimit(req);
  if (limit.blocked) return limit.response;

  const payload = await req.json().catch(() => ({} as Record<string, any>));

  const protagonistName = (payload.protagonistName as string) || 'Player';
  const heroineName = (payload.heroineName as string) || 'Yuki';
  const plotDescription = payload.plotDescription as string | undefined;

  const script = await generateScript(protagonistName, heroineName, plotDescription);
  const jsonString = JSON.stringify({ generatedAt: new Date().toISOString(), script }, null, 2);

  const res = new NextResponse(jsonString, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="galgame-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });

  if (limit.cookieToSet && limit.cookieName) {
    res.cookies.set(limit.cookieName, limit.cookieToSet, { path: '/', maxAge: 60 * 60 * 24 * 30, httpOnly: true });
  }

  return res;
}

