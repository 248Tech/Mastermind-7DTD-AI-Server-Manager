import { clientIp } from './client-ip.ts';
import { timingSafeEqualText } from './timing-safe.ts';
import { pruneMap } from './ttl-map.ts';
import { sanitizeInstallToken, sanitizeInstallUrl } from './install-script.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(clientIp({ headers: { 'cf-connecting-ip': '203.0.113.9' }, ip: '10.0.0.1' }) === '203.0.113.9', 'prefers Cloudflare connecting IP');
assert(clientIp({ headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } }) === '198.51.100.2', 'uses first forwarded hop');
assert(clientIp({ ip: '127.0.0.1' }) === '127.0.0.1', 'falls back to socket IP');
assert(clientIp({ headers: { 'cf-connecting-ip': 'a'.repeat(200) } }).length === 128, 'caps IP length');

assert(timingSafeEqualText('webhook-secret', 'webhook-secret') === true, 'equal secrets match');
assert(timingSafeEqualText('webhook-secret', 'webhook-secreX') === false, 'same-length mismatch fails');
assert(timingSafeEqualText('short', 'much-longer-secret') === false, 'length mismatch fails');
assert(timingSafeEqualText('', 'x') === false, 'empty vs non-empty fails');

const samples = new Map([
  ['fresh', [Date.now()]],
  ['stale', [Date.now() - 60_000]],
]);
const cutoff = Date.now() - 10_000;
assert(pruneMap(samples, (value) => value.some((t) => t >= cutoff)) === 1, 'removes stale map keys');
assert(samples.has('fresh') && !samples.has('stale'), 'keeps only fresh keys');

const discordWindows = new Map([
  ['org-a', { count: 3, windowStart: Date.now() - 1_000 }],
  ['org-b', { count: 10, windowStart: Date.now() - 120_000 }],
]);
assert(pruneMap(discordWindows, (entry) => Date.now() - entry.windowStart < 60_000) === 1, 'drops expired rate-limit windows');
assert(discordWindows.has('org-a') && !discordWindows.has('org-b'), 'keeps active Discord windows');

assert(sanitizeInstallUrl('https://mm.mg7d.com') === 'https://mm.mg7d.com', 'accepts https control-plane URL');
assert(sanitizeInstallUrl('javascript:alert(1)') === '', 'rejects javascript URLs');
assert(sanitizeInstallUrl('https://user:pass@evil.example/') === '', 'rejects embedded credentials');
assert(sanitizeInstallUrl('not a url') === '', 'rejects invalid URLs');
assert(sanitizeInstallToken('abcdefghijklmnop') === 'abcdefghijklmnop', 'accepts base64url tokens');
assert(sanitizeInstallToken('"; rm -rf /; #') === 'MISSING_TOKEN', 'rejects script injection tokens');
assert(sanitizeInstallToken('short') === 'MISSING_TOKEN', 'rejects short tokens');

console.log('security util tests passed');
