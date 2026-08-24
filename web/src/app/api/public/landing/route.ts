import { NextRequest } from 'next/server';

export async function GET(_request: NextRequest) {
  const control = (process.env.CONTROL_PLANE_INTERNAL_URL || 'http://control-plane:3001').replace(/\/$/, '');
  const response = await fetch(`${control}/api/public/landing`, { cache: 'no-store' }).catch(() => null);
  if (!response) return Response.json({ ok: false, orgName: null, headline: 'Mastermind', servers: [], message: 'Landing is unavailable' }, { status: 503 });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
