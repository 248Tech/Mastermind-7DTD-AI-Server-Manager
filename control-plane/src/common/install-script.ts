/** Allow only credential-free http(s) control-plane URLs in generated install scripts. */
export function sanitizeInstallUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password) return '';
    parsed.hash = '';
    let normalized = parsed.toString();
    if (parsed.pathname === '/' && !parsed.search) normalized = normalized.replace(/\/$/, '');
    return normalized;
  } catch {
    return '';
  }
}

/** Pairing tokens are base64url. Reject anything else before interpolating into a script. */
export function sanitizeInstallToken(token: string): string {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token) ? token : 'MISSING_TOKEN';
}
