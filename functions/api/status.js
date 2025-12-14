export async function onRequest(context) {
  return Response.json(
    { error: 'Status polling is disabled. POST /api/generate returns the result directly.' },
    { status: 410 }
  );
}
