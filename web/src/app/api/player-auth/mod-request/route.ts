import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const token = request.cookies.get('mm_player_session')?.value;
  if (!token) return Response.json({ message: 'Player sign-in required' }, { status: 401 });
  const control = (process.env.CONTROL_PLANE_INTERNAL_URL || 'http://control-plane:3001').replace(/\/$/, '');
  const form = await request.formData();
  const response = await fetch(`${control}/api/player-auth/mod-request`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
    cache: 'no-store',
  });
  return new Response(response.body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
  });
}
