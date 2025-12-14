import { generatePayload } from './_shared/generator';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch (e) {
    // Keep payload empty if the client did not send JSON.
  }

  try {
    const jsonString = await generatePayload(env, payload);
    return new Response(jsonString, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="galgame-${Date.now()}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return Response.json({ error: (error instanceof Error ? error.message : 'generation failed') }, { status: 500 });
  }
}
