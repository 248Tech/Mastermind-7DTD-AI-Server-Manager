type ClientRequest = { ip?: string; headers?: Record<string, string | string[] | undefined> };

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value?.split(',')[0]?.trim();
}

/** Prefer Cloudflare's connecting IP, then the first forwarded hop, then the socket address. */
export function clientIp(req: ClientRequest): string {
  return (
    firstHeader(req.headers?.['cf-connecting-ip']) ||
    firstHeader(req.headers?.['x-forwarded-for']) ||
    req.ip ||
    'unknown'
  ).slice(0, 128);
}
