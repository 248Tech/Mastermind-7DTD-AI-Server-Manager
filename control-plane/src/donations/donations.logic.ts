export const MIN_DONATION_CENTS = 500;
export const MAX_DONATION_CENTS = 50_000;

export type DonationStatus = 'completed' | 'refunded';

export type LedgerDonation = {
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  amountCents: number;
  refundedCents: number;
  status: DonationStatus;
};

export type LedgerPlayer = {
  supporter: boolean;
  supporterSince: Date | null;
  totalDonatedCents: number;
};

export function parseDonationAmountCents(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  if (raw < MIN_DONATION_CENTS || raw > MAX_DONATION_CENTS) return null;
  return raw;
}

export function creditCompletedSession(
  existing: LedgerDonation | null,
  input: { stripeCheckoutSessionId: string; stripePaymentIntentId: string | null; amountCents: number },
  player: LedgerPlayer,
  at: Date,
): { donation: LedgerDonation; player: LedgerPlayer; applied: boolean } {
  if (existing) return { donation: existing, player, applied: false };
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return {
      donation: {
        stripeCheckoutSessionId: input.stripeCheckoutSessionId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountCents: 0,
        refundedCents: 0,
        status: 'completed',
      },
      player,
      applied: false,
    };
  }
  const total = player.totalDonatedCents + input.amountCents;
  return {
    applied: true,
    donation: {
      stripeCheckoutSessionId: input.stripeCheckoutSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      amountCents: input.amountCents,
      refundedCents: 0,
      status: 'completed',
    },
    player: {
      supporter: total > 0,
      supporterSince: player.supporterSince ?? (total > 0 ? at : null),
      totalDonatedCents: total,
    },
  };
}

export function applyChargeRefund(
  donation: LedgerDonation | null,
  refundedCents: number,
  player: LedgerPlayer,
): { donation: LedgerDonation | null; player: LedgerPlayer; applied: boolean; delta: number } {
  if (!donation) return { donation: null, player, applied: false, delta: 0 };
  const nextRefunded = Math.min(donation.amountCents, Math.max(donation.refundedCents, Math.trunc(refundedCents) || 0));
  const delta = nextRefunded - donation.refundedCents;
  if (delta <= 0) return { donation, player, applied: false, delta: 0 };
  const total = Math.max(0, player.totalDonatedCents - delta);
  return {
    applied: true,
    delta,
    donation: {
      ...donation,
      refundedCents: nextRefunded,
      status: nextRefunded >= donation.amountCents ? 'refunded' : 'completed',
    },
    player: {
      supporter: total > 0,
      supporterSince: total > 0 ? player.supporterSince : null,
      totalDonatedCents: total,
    },
  };
}

export function stripeObjectId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 255);
  if (value && typeof value === 'object' && 'id' in value && typeof (value as { id: unknown }).id === 'string') {
    return (value as { id: string }).id.trim().slice(0, 255) || null;
  }
  return null;
}

export function parsePaidCheckoutSession(object: Record<string, unknown>): {
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number;
  currency: string;
  playerId: string;
  steamId: string;
  serverInstanceId: string;
  orgId: string;
  shopItemId: string | null;
  shopItemIds: string[];
  lineAmounts: number[];
} | null {
  if (object.payment_status !== 'paid') return null;
  const sessionId = stripeObjectId(object.id);
  const amountCents = typeof object.amount_total === 'number' && Number.isInteger(object.amount_total) ? object.amount_total : null;
  const metadata = object.metadata && typeof object.metadata === 'object' ? (object.metadata as Record<string, unknown>) : {};
  const playerId = typeof metadata.playerId === 'string' ? metadata.playerId : stripeObjectId(object.client_reference_id);
  const steamId = typeof metadata.steamId === 'string' ? metadata.steamId : '';
  const serverInstanceId = typeof metadata.serverInstanceId === 'string' ? metadata.serverInstanceId : '';
  const orgId = typeof metadata.orgId === 'string' ? metadata.orgId : '';
  const shopItemIds = typeof metadata.shopItemIds === 'string' && metadata.shopItemIds.trim()
    ? metadata.shopItemIds.split(',').map((part) => part.trim()).filter((id) => /^[a-z0-9_-]{10,40}$/i.test(id))
    : typeof metadata.shopItemId === 'string' && /^[a-z0-9_-]{10,40}$/i.test(metadata.shopItemId)
      ? [metadata.shopItemId]
      : [];
  const shopItemId = shopItemIds.length === 1 ? shopItemIds[0] : null;
  const lineAmounts = typeof metadata.lineAmounts === 'string' && metadata.lineAmounts.trim()
    ? metadata.lineAmounts.split(',').map((part) => Number(part.trim())).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (!sessionId || !amountCents || amountCents <= 0 || !playerId || !steamId || !serverInstanceId || !orgId) return null;
  return {
    sessionId,
    paymentIntentId: stripeObjectId(object.payment_intent),
    amountCents,
    currency: typeof object.currency === 'string' && object.currency ? object.currency.slice(0, 8) : 'usd',
    playerId,
    steamId,
    serverInstanceId,
    orgId,
    shopItemId,
    shopItemIds,
    lineAmounts,
  };
}

export function parseChargeRefund(object: Record<string, unknown>): { paymentIntentId: string; refundedCents: number } | null {
  const paymentIntentId = stripeObjectId(object.payment_intent);
  const refundedCents = typeof object.amount_refunded === 'number' && Number.isInteger(object.amount_refunded)
    ? object.amount_refunded
    : typeof object.amount === 'number' && object.refunded === true && Number.isInteger(object.amount)
      ? object.amount
      : null;
  if (!paymentIntentId || refundedCents == null || refundedCents < 0) return null;
  return { paymentIntentId, refundedCents };
}

export function parseLostDispute(object: Record<string, unknown>): { paymentIntentId: string; refundedCents: number } | null {
  if (object.status !== 'lost') return null;
  const paymentIntentId = stripeObjectId(object.payment_intent);
  const refundedCents = typeof object.amount === 'number' && Number.isInteger(object.amount) ? object.amount : null;
  if (!paymentIntentId || refundedCents == null || refundedCents <= 0) return null;
  return { paymentIntentId, refundedCents };
}
