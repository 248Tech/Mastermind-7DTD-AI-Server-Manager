export type PrismaCoreConfig = {
  url: string;
  user: string;
  password: string;
};

export function prismacoreConfig(
  env: NodeJS.Dict<string> = process.env,
): PrismaCoreConfig | null {
  const url = (env.PRISMACORE_WEB_URL || '').trim().replace(/\/$/, '');
  const user = (env.PRISMACORE_API_USER || '').trim();
  const password = env.PRISMACORE_API_PASSWORD || '';
  if (!url || !user || !password) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return { url, user, password };
}

export function prismacoreConfigured(env: NodeJS.Dict<string> = process.env): boolean {
  return Boolean(prismacoreConfig(env));
}

const BLOCKED_PATH = /createadvclaims/i;

export function prismacoreRequestUrl(
  config: PrismaCoreConfig,
  path: string,
  query: Record<string, string | undefined> = {},
): URL {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (BLOCKED_PATH.test(suffix)) throw new Error('PrismaCore write APIs are not allowed');
  const target = new URL(`${config.url}${suffix}`);
  if (target.origin !== new URL(config.url).origin) throw new Error('PrismaCore URL origin mismatch');
  target.searchParams.set('apiuser', config.user);
  target.searchParams.set('password', config.password);
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') target.searchParams.set(key, value);
  }
  return target;
}

export type PrismaCoreGetResult =
  | { ok: true; configured: true; json: unknown }
  | { ok: false; configured: false }
  | { ok: false; configured: true; status?: number };

export async function prismacoreGet(
  path: string,
  query: Record<string, string | undefined> = {},
  env: NodeJS.Dict<string> = process.env,
  timeoutMs = 5000,
): Promise<PrismaCoreGetResult> {
  const config = prismacoreConfig(env);
  if (!config) return { ok: false, configured: false };
  const url = prismacoreRequestUrl(config, path, query);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: ac.signal,
    });
    if (!response.ok) return { ok: false, configured: true, status: response.status };
    return { ok: true, configured: true, json: await response.json() };
  } catch {
    return { ok: false, configured: true };
  } finally {
    clearTimeout(timer);
  }
}

export function publicShopLive(input: { reachable?: boolean; playersOnline?: number }): {
  serverReachable: boolean;
  playersOnline: number;
} {
  const count = Number(input.playersOnline);
  return {
    serverReachable: Boolean(input.reachable),
    playersOnline: Number.isInteger(count) && count >= 0 ? Math.min(count, 256) : 0,
  };
}

export const SHOP_STATUS_PUBLIC_KEYS = ['serverName', 'checkoutEnabled', 'serverReachable', 'playersOnline'] as const;

export function shopStatusPublicKeys(status: Record<string, unknown>): string[] {
  return Object.keys(status).sort();
}

export function shopStatusHasOnlyPublicKeys(status: Record<string, unknown>): boolean {
  const allowed = new Set<string>(SHOP_STATUS_PUBLIC_KEYS);
  return Object.keys(status).every((key) => allowed.has(key));
}
