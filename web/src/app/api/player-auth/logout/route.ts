import { NextRequest, NextResponse } from 'next/server';
export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('mm_player_session', '', { httpOnly: true, sameSite: 'lax', secure: request.nextUrl.protocol === 'https:', path: '/', maxAge: 0 });
  return response;
}
