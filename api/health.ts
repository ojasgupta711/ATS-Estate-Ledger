// Vercel serverless function placeholder.
// Version 1 runs entirely in the browser; this endpoint is where the server
// side (auth, database, imports) will grow in the next phase.
export function GET(): Response {
  return Response.json({ status: 'ok', app: 'ATS Estate Ledger', version: '0.1.0' });
}
