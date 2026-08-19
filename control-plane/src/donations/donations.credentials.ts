import { PrismaService } from '../prisma.service';
import { decryptIntegrationSecret } from '../orgs/integration-crypto';
import { stripeCheckoutConfigured, stripeSecretKey, stripeWebhookSecret } from './donations.stripe';

export type OrgStripeCredentials = { secretKey: string; webhookSecret: string };

function decryptSecret(value: string | null | undefined): string {
  if (!value?.trim()) return '';
  try {
    return decryptIntegrationSecret(value).trim();
  } catch {
    return '';
  }
}

export async function stripeCredentialsForOrg(prisma: PrismaService, orgId: string): Promise<OrgStripeCredentials | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeSecretKeyEncrypted: true, stripeWebhookSecretEncrypted: true },
  });
  const secretKey = decryptSecret(org?.stripeSecretKeyEncrypted) || stripeSecretKey();
  const webhookSecret = decryptSecret(org?.stripeWebhookSecretEncrypted) || stripeWebhookSecret();
  if (!secretKey || !webhookSecret) return null;
  return { secretKey, webhookSecret };
}

export async function stripeCheckoutEnabledForOrg(prisma: PrismaService, orgId: string): Promise<boolean> {
  if (stripeCheckoutConfigured()) return true;
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { stripeSecretKeyEncrypted: true, stripeWebhookSecretEncrypted: true },
  });
  return Boolean(org?.stripeSecretKeyEncrypted && org?.stripeWebhookSecretEncrypted);
}

export async function stripeWebhookSecrets(prisma: PrismaService): Promise<string[]> {
  const secrets: string[] = [];
  const envSecret = stripeWebhookSecret();
  if (envSecret) secrets.push(envSecret);
  const orgs = await prisma.org.findMany({
    where: { stripeWebhookSecretEncrypted: { not: null } },
    select: { stripeWebhookSecretEncrypted: true },
    take: 25,
  });
  for (const org of orgs) {
    const secret = decryptSecret(org.stripeWebhookSecretEncrypted);
    if (secret) secrets.push(secret);
  }
  return [...new Set(secrets)];
}
