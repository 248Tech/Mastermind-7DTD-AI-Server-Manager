export type AllocsConfig = {
  url: string;
  tokenName: string;
  secret: string;
};

const ALLOWED_ENDPOINTS = new Set([
  'gethostilelocation',
  'getanimalslocation',
  'getplayerslocation',
  'getplayerinventory',
  'executeconsolecommand',
]);

export function allocsConfig(env: NodeJS.Dict<string> = process.env): AllocsConfig | null {
  const url = (env.SEVENDTD_WEB_URL || '').trim().replace(/\/$/, '');
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return {
    url,
    tokenName: (env.SEVENDTD_WEB_API_TOKEN_NAME || '').trim(),
    secret: env.SEVENDTD_WEB_API_SECRET || '',
  };
}

export function allocsConfigured(env: NodeJS.Dict<string> = process.env): boolean {
  return Boolean(allocsConfig(env));
}

export function allocsTokenConfigured(env: NodeJS.Dict<string> = process.env): boolean {
  const config = allocsConfig(env);
  return Boolean(config?.tokenName && config.secret);
}

export function allocsRequestUrl(
  config: AllocsConfig,
  endpoint: string,
  query: Record<string, string | undefined> = {},
): URL {
  const name = endpoint.replace(/^\//, '').replace(/^api\//, '');
  if (!ALLOWED_ENDPOINTS.has(name)) throw new Error('Allocs endpoint is not allowed');
  const target = new URL(`${config.url}/api/${name}`);
  if (target.origin !== new URL(config.url).origin) throw new Error('Allocs URL origin mismatch');
  for (const [key, value] of Object.entries(query)) {
    if (value != null && value !== '') target.searchParams.set(key, value);
  }
  return target;
}

export function allocsAuthHeaders(config: AllocsConfig): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (config.tokenName && config.secret) {
    headers['X-SDTD-API-TOKENNAME'] = config.tokenName;
    headers['X-SDTD-API-SECRET'] = config.secret;
  }
  return headers;
}

export type AllocsGetResult =
  | { ok: true; configured: true; json: unknown }
  | { ok: false; configured: false }
  | { ok: false; configured: true; status?: number };

export async function allocsGet(
  endpoint: string,
  query: Record<string, string | undefined> = {},
  env: NodeJS.Dict<string> = process.env,
  timeoutMs = 5000,
): Promise<AllocsGetResult> {
  const config = allocsConfig(env);
  if (!config) return { ok: false, configured: false };
  const url = allocsRequestUrl(config, endpoint, query);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: allocsAuthHeaders(config),
      cache: 'no-store',
      redirect: 'error',
      signal: ac.signal,
    });
    if (!response.ok) return { ok: false, configured: true, status: response.status };
    const text = await response.text();
    try {
      return { ok: true, configured: true, json: text ? JSON.parse(text) : {} };
    } catch {
      return { ok: true, configured: true, json: { result: text } };
    }
  } catch {
    return { ok: false, configured: true };
  } finally {
    clearTimeout(timer);
  }
}

export function publicMapPayloadKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).sort();
}

export function mapPayloadHasNoSecrets(payload: unknown): boolean {
  const blob = JSON.stringify(payload);
  return !/admintoken|adminuser|SEVENDTD_WEB_API|webtoken|password=|X-SDTD-API-SECRET/i.test(blob);
}
