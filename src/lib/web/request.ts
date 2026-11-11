// Shared API-route prologue: parse a JSON body, tolerating absent or invalid
// JSON (an empty object keeps each route's `missing X` validation intact).
export async function readJsonBody(request: Request): Promise<any> {
  try { return await request.json(); } catch { return {}; }
}
