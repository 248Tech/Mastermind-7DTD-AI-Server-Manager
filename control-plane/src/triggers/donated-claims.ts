import { PrismaService } from '../prisma.service';
import { parseGrantItemList } from '../donations/shop-grants';

export const MAX_STACKED_CLAIMS = 100;

export function inferBonusLandClaims(
  itemName: string,
  grantItems: unknown,
  explicit = 0,
  lineQuantity = 1,
): number {
  const qty = Number.isInteger(lineQuantity) && lineQuantity > 0 ? lineQuantity : 1;
  if (Number.isInteger(explicit) && explicit > 0) return Math.min(50, explicit) * qty;
  const grants = parseGrantItemList(grantItems);
  let inferred = 0;
  if (grants) {
    for (const grant of grants) {
      if (/keystone|landclaim|land_claim/i.test(grant.name)) inferred += grant.quantity;
    }
  }
  if (inferred < 1 && /land\s*claim|extra\s*claim/i.test(itemName || '')) inferred = 1;
  return Math.min(50, inferred) * qty;
}

export async function donatedBonusClaims(prisma: PrismaService, playerId: string): Promise<number> {
  const lines = await prisma.donationLine.findMany({
    where: { donation: { playerId, status: 'completed' } },
    select: { itemName: true, quantity: true, bonusLandClaims: true, grantItems: true, grantItemName: true, grantQuantity: true },
  });
  let total = 0;
  for (const line of lines) {
    const grants = line.grantItems ?? (line.grantItemName ? [{ name: line.grantItemName, quantity: line.grantQuantity ?? 1 }] : []);
    total += inferBonusLandClaims(line.itemName, grants, line.bonusLandClaims, line.quantity);
  }
  return Math.min(MAX_STACKED_CLAIMS, total);
}

export function stackedClaimCount(base: number, donated: number): number {
  return Math.min(MAX_STACKED_CLAIMS, Math.max(0, base + donated));
}

export function totalLandClaimLimit(serverDefault: number, bonusClaims: number): number {
  const base = Number.isInteger(serverDefault) && serverDefault > 0 ? serverDefault : 1;
  const bonus = Number.isInteger(bonusClaims) && bonusClaims >= 0 ? bonusClaims : 0;
  return Math.min(MAX_STACKED_CLAIMS, base + bonus);
}
