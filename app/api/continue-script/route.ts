import { NextRequest, NextResponse } from 'next/server';
import { continueStory, continueStoryStream, withAiDebug, withAiDebugStream } from '@/lib/aiServer';
import { getUserIdFromRequest } from '@/lib/authSession';
import { enforceNoCnPoliticalSensitive, enforcePolicyAccepted } from '@/lib/policy';

export async function POST(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return NextResponse.json({ error: '未登录' }, { status: 401 });

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

  const acceptRes = await enforcePolicyAccepted({ userId });
  if (acceptRes) return acceptRes;

  const policyRes = await enforceNoCnPoliticalSensitive({
    userId,
    inputs: [protagonistName, heroineName, userChoiceText],
  });
  if (policyRes) return policyRes;

  if (stream) {
    const encoder = new TextEncoder();
    const { stream: aiStream, debugStore } = withAiDebugStream(() =>
      continueStoryStream({
        protagonistName,
        heroineName,
        userChoiceText,
        affinity,
        allowedBackgroundPrompts,
        recentDialogue,
        signal: req.signal,
      })
    );
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const evt of aiStream) {
            controller.enqueue(encoder.encode(JSON.stringify(evt) + '\n'));
          }
          if (debugStore && debugStore.entries.length > 0) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: 'debug', debug: debugStore.entries }) + '\n'));
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
    const { result, debug } = await withAiDebug(() =>
      continueStory({
        protagonistName,
        heroineName,
        userChoiceText,
        affinity,
        allowedBackgroundPrompts,
        recentDialogue,
      })
    );
    const { nodes, startNodeId, affinityDelta, ending } = result;
    return NextResponse.json(debug ? { nodes, startNodeId, affinityDelta, ending, debug } : { nodes, startNodeId, affinityDelta, ending });
  } catch (err: any) {
    console.error('continue-script failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to continue script' }, { status: 500 });
  }
}
