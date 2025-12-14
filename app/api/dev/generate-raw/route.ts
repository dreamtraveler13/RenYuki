import { NextRequest, NextResponse } from 'next/server';
import { generateScriptRaw } from '@/lib/aiServer';

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as Record<string, any>));

  const protagonistName = (payload.protagonistName as string) || 'Player';
  const heroineName = (payload.heroineName as string) || 'Yuki';
  const plotDescription = payload.plotDescription as string | undefined;

  const rawJsonText = await generateScriptRaw(protagonistName, heroineName, plotDescription);

  const res = new NextResponse(rawJsonText, {
    status: 200,
    headers: {
      // Return the model output exactly as-is; do not parse/validate/transform server-side.
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="galgame-raw-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });

  return res;
}
