export async function onRequest(context) {
  return Response.json(
    { error: 'Direct download is no longer needed. Use POST /api/generate to receive the payload.' },
    { status: 410 }
  );
}
