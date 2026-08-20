import { createHmac, timingSafeEqual } from 'crypto';

const CHECKOUT_URL = 'https://api.stripe.com/v1/checkout/sessions';
const SIGNATURE_TOLERANCE_SEC = 300;

function nonDefaultSecret(value: string | undefined): string {
  const secret = value?.trim() ?? '';
  if (!secret || /change-me/i.test(secret)) return '';
  return secret;
}

function coded(code: 'unconfigured' | 'bad_signature', message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export function parseStripeSecretKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^sk_(test|live)_[A-Za-z0-9]{16,220}$/.test(value)) return null;
  return value;
}

export function parseStripeWebhookSecret(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!/^whsec_[A-Za-z0-9+/=_-]{16,220}$/.test(value)) return null;
  return value;
}

export function stripeSecretKey(): string {
  return nonDefaultSecret(process.env.STRIPE_SECRET_KEY);
}

export function stripeWebhookSecret(): string {
  return nonDefaultSecret(process.env.STRIPE_WEBHOOK_SECRET);
}

export function stripeCheckoutConfigured(): boolean {
  return Boolean(stripeSecretKey() && stripeWebhookSecret());
}

export function generateTestHeaderString(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

export function verifyStripeSignature(payload: string, header: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't') timestamp = value ?? '';
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const age = Math.abs(nowSec - Number(timestamp));
  if (age > SIGNATURE_TOLERANCE_SEC) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return signatures.some((signature) => safeEqualHex(signature, expected));
}

export function constructStripeEvent(rawBody: Buffer | string, signature: string | undefined, secret = stripeWebhookSecret()) {
  if (!secret) throw coded('unconfigured', 'Stripe webhook is not configured');
  if (!signature?.trim()) throw coded('bad_signature', 'Stripe signature missing');
  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  if (!verifyStripeSignature(payload, signature, secret)) throw coded('bad_signature', 'Stripe signature invalid');
  let event: { type?: unknown; data?: { object?: unknown } };
  try {
    event = JSON.parse(payload) as { type?: unknown; data?: { object?: unknown } };
  } catch {
    throw coded('bad_signature', 'Stripe event invalid');
  }
  if (!event || typeof event.type !== 'string') throw coded('bad_signature', 'Stripe event invalid');
  const object = event.data && typeof event.data === 'object' && event.data.object && typeof event.data.object === 'object'
    ? event.data.object as Record<string, unknown>
    : {};
  return { type: event.type, data: { object } };
}

export function constructStripeEventWithSecrets(rawBody: Buffer | string, signature: string | undefined, secrets: string[]) {
  const unique = [...new Set(secrets.map((secret) => secret.trim()).filter(Boolean))];
  if (!unique.length) throw coded('unconfigured', 'Stripe webhook is not configured');
  let last: Error | null = null;
  for (const secret of unique) {
    try {
      return constructStripeEvent(rawBody, signature, secret);
    } catch (error) {
      last = error as Error;
      if ((error as { code?: string }).code !== 'bad_signature') throw error;
    }
  }
  throw last ?? coded('bad_signature', 'Stripe signature invalid');
}

export type CheckoutLineItem = {
  amountCents: number;
  name: string;
  description: string;
  shopItemId?: string;
};

export async function createCheckoutSession(input: {
  amountCents?: number;
  playerId: string;
  steamId: string;
  serverInstanceId: string;
  orgId: string;
  origin: string;
  secretKey?: string;
  productName?: string;
  productDescription?: string;
  shopItemId?: string;
  lineItems?: CheckoutLineItem[];
  returnPath?: string;
}): Promise<{ url: string }> {
  const key = nonDefaultSecret(input.secretKey) || stripeSecretKey();
  if (!key) throw coded('unconfigured', 'Donations are not configured');
  const returnPath = input.returnPath || '/player/profile';
  const lineItems = input.lineItems?.length
    ? input.lineItems
    : [{
        amountCents: input.amountCents ?? 0,
        name: input.productName || 'Server support',
        description: input.productDescription || `Support tied to Steam ending ${input.steamId.slice(-4)}`,
        shopItemId: input.shopItemId,
      }];
  if (!lineItems.length || lineItems.some((item) => !Number.isInteger(item.amountCents) || item.amountCents <= 0)) {
    throw coded('unconfigured', 'Checkout is unavailable');
  }
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', input.playerId);
  body.set('success_url', `${input.origin}${returnPath}?donation=success`);
  body.set('cancel_url', `${input.origin}${returnPath}?donation=cancel`);
  body.set('metadata[playerId]', input.playerId);
  body.set('metadata[steamId]', input.steamId);
  body.set('metadata[serverInstanceId]', input.serverInstanceId);
  body.set('metadata[orgId]', input.orgId);
  const shopItemIds = lineItems.map((item) => item.shopItemId).filter((id): id is string => Boolean(id));
  if (shopItemIds.length) {
    body.set('metadata[shopItemIds]', shopItemIds.join(','));
    body.set('metadata[lineAmounts]', lineItems.map((item) => String(item.amountCents)).join(','));
    if (shopItemIds.length === 1) body.set('metadata[shopItemId]', shopItemIds[0]);
  }
  body.set('payment_intent_data[metadata][playerId]', input.playerId);
  body.set('payment_intent_data[metadata][steamId]', input.steamId);
  body.set('payment_intent_data[metadata][serverInstanceId]', input.serverInstanceId);
  body.set('payment_intent_data[metadata][orgId]', input.orgId);
  if (shopItemIds.length) {
    body.set('payment_intent_data[metadata][shopItemIds]', shopItemIds.join(','));
    if (shopItemIds.length === 1) body.set('payment_intent_data[metadata][shopItemId]', shopItemIds[0]);
  }
  lineItems.forEach((item, index) => {
    body.set(`line_items[${index}][quantity]`, '1');
    body.set(`line_items[${index}][price_data][currency]`, 'usd');
    body.set(`line_items[${index}][price_data][unit_amount]`, String(item.amountCents));
    body.set(`line_items[${index}][price_data][product_data][name]`, item.name.slice(0, 120));
    body.set(`line_items[${index}][price_data][product_data][description]`, item.description.slice(0, 250));
  });
  const response = await fetch(CHECKOUT_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) throw coded('unconfigured', 'Checkout is unavailable');
  const payload = await response.json().catch(() => null) as { url?: unknown; error?: { message?: string } } | null;
  if (!response.ok || typeof payload?.url !== 'string' || !isStripeHttpsUrl(payload.url)) {
    throw coded('unconfigured', 'Checkout is unavailable');
  }
  return { url: payload.url };
}

function isStripeHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && (parsed.hostname === 'checkout.stripe.com' || parsed.hostname.endsWith('.stripe.com'));
  } catch {
    return false;
  }
}

function safeEqualHex(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
