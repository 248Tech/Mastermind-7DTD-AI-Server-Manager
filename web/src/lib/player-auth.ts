import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const secret = () => process.env.PLAYER_SESSION_SECRET || process.env.JWT_SECRET || 'change-me-player-session';
const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');

export function makeSteamState(serverInstanceId: string, next = '/player/map') {
  const nonce = randomBytes(24).toString('base64url');
  const payload = encode(JSON.stringify({ serverInstanceId, nonce, next: parsePlayerReturnPath(next), expires: Date.now() + 10 * 60_000 }));
  const signature = encode(createHmac('sha256', secret()).update(payload).digest());
  return { state: `${payload}.${signature}`, nonce };
}

export function readSteamState(state: string, cookieNonce: string | undefined) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || !cookieNonce) return null;
  const expected = createHmac('sha256', secret()).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { serverInstanceId?: string; nonce?: string; next?: string; expires?: number };
    if (value.nonce !== cookieNonce || !value.serverInstanceId || Number(value.expires) < Date.now()) return null;
    return { ...value, next: parsePlayerReturnPath(value.next) };
  } catch { return null; }
}

export function parsePlayerReturnPath(raw: unknown, fallback = '/player/map') {
  if (typeof raw !== 'string') return fallback;
  const path = raw.trim();
  if (path === '/player' || path === '/player/shop' || path === '/player/shop/cart' || path === '/player/map' || path === '/player/profile') return path;
  if (/^\/player\/shop\/[a-zA-Z0-9_-]{10,40}$/.test(path)) return path;
  return fallback;
}

export function requestOrigin(request: Request) {
  const current = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = forwardedHost || request.headers.get('host') || current.host;
  const protocol = forwardedProto === 'https' || forwardedProto === 'http' ? `${forwardedProto}:` : current.protocol;
  if (!/^[A-Za-z0-9.:[\]-]+(?::\d+)?$/.test(host)) return current.origin;
  return `${protocol}//${host}`;
}
