import { NextRequest, NextResponse } from 'next/server';
import { continueStory, continueStoryStream } from '@/lib/aiServer';

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => ({} as Record<string, any>));

  const protagonistName = (payload.protagonistName as string) || 'Player';
  const heroineName = (payload.heroineName as string) || 'Yuki';
  const userChoiceText = (payload.userChoiceText as string) || '';
  const affinity = typeof payload.affinity === 'number' ? payload.affinity : undefined;
  const allowedBackgroundPrompts = Array.isArray(payload.allowedBackgroundPrompts) ? payload.allowedBackgroundPrompts : [];
  const recentDialogue = Array.isArray(payload.recentDialogue) ? payload.recentDialogue : [];
  const stream = payload.stream === true || payload.stream === 1 || payload.stream === '1';

  if (!userChoiceText.trim()) {
    return NextResponse.json({ error: 'userChoiceText is required' }, { status: 400 });
  }

  if (stream) {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const evt of continueStoryStream({
            protagonistName,
            heroineName,
            userChoiceText,
            affinity,
            allowedBackgroundPrompts,
            recentDialogue,
            signal: req.signal,
          })) {
            controller.enqueue(encoder.encode(JSON.stringify(evt) + '\n'));
          }
        } catch (err: any) {
          const message = err?.message || 'Failed to continue script';
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', error: message }) + '\n'));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  try {
    const { nodes, startNodeId, affinityDelta, ending } = await continueStory({
      protagonistName,
      heroineName,
      userChoiceText,
      affinity,
      allowedBackgroundPrompts,
      recentDialogue,
    });

    return NextResponse.json({ nodes, startNodeId, affinityDelta, ending });
  } catch (err: any) {
    console.error('continue-script failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to continue script' }, { status: 500 });
  }
}
