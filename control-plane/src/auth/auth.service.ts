import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { MailgunService } from '../mailgun/mailgun.service';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { decryptIntegrationSecret } from '../orgs/integration-crypto';

const SALT_BYTES = 16;

function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString('hex');
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(salt + password).digest('hex');
}

export function makePasswordHash(password: string): string {
  const salt = generateSalt();
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

// Unknown accounts still perform the same expensive password verification as
// real accounts, reducing username discovery through response timing.
export const DUMMY_PASSWORD_HASH = makePasswordHash(randomBytes(32).toString('hex'));

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith('scrypt$')) {
    const [, salt, hash] = storedHash.split('$');
    if (!salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
  // Backward compatibility for existing salt:sha256 accounts. Password changes migrate to scrypt.
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt);
  // Constant-time compare using Buffer
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailgun: MailgunService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash || !verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new ConflictException('New password must differ from current password');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: makePasswordHash(newPassword), authVersion: { increment: 1 } },
    });
  }

  /**
   * Public registration always joins the default organization as a pending
   * viewer. Organization selection and elevated roles are admin-only actions.
   */
  async register(
    email: string,
    password: string,
    name?: string,
    ip = 'unknown',
  ): Promise<
    | { verification_required: true; email: string }
    | { approval_required: true; email: string }
    | { registration_received: true }
  > {
    email = email.trim().toLowerCase();
    // Check for existing email
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { registration_received: true };
    }

    const targetOrgId = (await this.getOrCreateDefaultOrg()).id;
    const role = await this.resolveRole('viewer');

    const passwordHash = makePasswordHash(password);
    const verificationRequired = await this.mailgun.isConfigured(targetOrgId);

    const ipHash = this.rateLimit.registrationIpHash(ip);
    const user = await this.prisma.$transaction(async tx => {
      const quota = await tx.$queryRaw<{ registrationCount: number }[]>`
        INSERT INTO "registration_ip_quotas"
          ("ip_hash", "registration_count", "created_at", "updated_at")
        VALUES (${ipHash}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("ip_hash") DO UPDATE SET
          "registration_count" = "registration_ip_quotas"."registration_count" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "registration_ip_quotas"."registration_count" < 2
        RETURNING "registration_count" AS "registrationCount"
      `;
      if (!quota.length) {
        throw new ForbiddenException(
          'This network has reached the two-account registration limit. Ask an administrator to create the account manually.',
        );
      }
      return tx.user.create({
        data: {
          email,
          name: name?.trim() || null,
          passwordHash,
          emailVerifiedAt: verificationRequired ? null : new Date(),
          userOrgs: {
            create: {
              orgId: targetOrgId,
              roleId: role.id,
            },
          },
        },
      });
    });

    if (verificationRequired) {
      await this.sendVerification(user.id, targetOrgId, user.email, user.name);
      return { verification_required: true, email: user.email };
    }
    return { approval_required: true, email: user.email };
  }

  /**
   * Login with email and password. Returns JWT and user/org info.
   */
  async login(
    email: string,
    password: string,
    ip: string,
    mathChallengeToken: string,
    mathAnswer: string,
    recaptchaToken?: string,
  ): Promise<{ access_token: string; userId: string; orgId: string }> {
    email = email.trim().toLowerCase();
    await this.rateLimit.assertLoginAllowed(email, ip);
    if (!this.verifyMathChallenge(mathChallengeToken, mathAnswer)) {
      await this.failLogin(email, ip, 'Solve the new math challenge and try again');
    }
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userOrgs: { include: { org: true }, take: 1 } },
    });

    const securityOrg = user?.userOrgs[0]?.org ?? await this.prisma.org.findFirst();
    if (securityOrg?.recaptchaSecretEncrypted) {
      const validCaptcha = await this.verifyRecaptcha(securityOrg.recaptchaSecretEncrypted, recaptchaToken, ip);
      if (!validCaptcha) await this.failLogin(email, ip, 'Complete the reCAPTCHA challenge and try again');
    }

    const valid = verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH);
    if (!user || !user.passwordHash || !valid) {
      return this.failLogin(email, ip, 'Invalid email or password');
    }

    const firstMembership = user.userOrgs[0];
    if (!user.emailVerifiedAt && firstMembership && await this.mailgun.isConfigured(firstMembership.orgId)) {
      throw new UnauthorizedException('Email verification required');
    }
    if (!user.approvedAt) {
      throw new ForbiddenException('Account is awaiting administrator approval');
    }

    // Use the first org the user belongs to
    const firstOrgId = user.userOrgs[0]?.orgId;
    if (!firstOrgId) throw new UnauthorizedException('Invalid email or password');

    const access_token = this.issueToken(user.id, firstOrgId, user.authVersion);
    await this.rateLimit.recordLoginSuccess(email, ip);
    await this.prisma.auditLog.create({
      data: { orgId: firstOrgId, actorId: user.id, action: 'login', resourceType: 'user', resourceId: user.id, ip: ip.slice(0, 128) },
    }).catch(() => undefined);
    return { access_token, userId: user.id, orgId: firstOrgId };
  }

  async getLoginSecurity() {
    const org = await this.prisma.org.findFirst({ orderBy: { createdAt: 'asc' }, select: { recaptchaSiteKey: true, recaptchaSecretEncrypted: true } });
    const left = randomInt(2, 13), right = randomInt(2, 13), subtract = randomInt(0, 3) === 0;
    const a = subtract ? Math.max(left, right) : left, b = subtract ? Math.min(left, right) : right;
    const operation = subtract ? '-' : '+';
    const mathChallengeToken = this.jwt.sign(
      { purpose: 'login-math', a, b, operation },
      { secret: process.env.MATH_CHALLENGE_SECRET || process.env.AUTH_RATE_LIMIT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '5m' },
    );
    return {
      mathPrompt: `${a} ${operation} ${b} = ?`,
      mathChallengeToken,
      recaptchaEnabled: Boolean(org?.recaptchaSiteKey && org?.recaptchaSecretEncrypted),
      recaptchaSiteKey: org?.recaptchaSiteKey || undefined,
    };
  }

  private verifyMathChallenge(token: string, answer: string): boolean {
    try {
      const payload = this.jwt.verify<{ purpose?:string;a?:number;b?:number;operation?:string }>(token, { secret: process.env.MATH_CHALLENGE_SECRET || process.env.AUTH_RATE_LIMIT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret' });
      if (payload.purpose !== 'login-math' || !Number.isInteger(payload.a) || !Number.isInteger(payload.b)) return false;
      const expected = payload.operation === '-' ? payload.a! - payload.b! : payload.a! + payload.b!;
      return /^-?\d+$/.test(answer.trim()) && Number(answer) === expected;
    } catch { return false; }
  }

  private async verifyRecaptcha(encryptedSecret:string,token:string|undefined,ip:string):Promise<boolean> {
    if (!token?.trim()) return false;
    const body = new URLSearchParams({ secret: decryptIntegrationSecret(encryptedSecret), response: token.trim(), remoteip: ip });
    let response:Response;
    try { response = await fetch('https://www.google.com/recaptcha/api/siteverify', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body, signal:AbortSignal.timeout(8000) }); }
    catch { throw new ServiceUnavailableException('reCAPTCHA verification is temporarily unavailable'); }
    if (!response.ok) throw new ServiceUnavailableException('reCAPTCHA verification is temporarily unavailable');
    const result = await response.json() as {success?:boolean;hostname?:string};
    if (!result.success) return false;
    try {
      const expected = new URL(process.env.PUBLIC_WEB_URL || 'http://localhost:3000').hostname;
      return expected === 'localhost' || !result.hostname || result.hostname === expected;
    } catch { return true; }
  }

  private async failLogin(email:string,ip:string,message:string):Promise<never> {
    const lockout = await this.rateLimit.recordLoginFailure(email, ip);
    if (lockout) this.rateLimit.throwActiveLockout(lockout);
    throw new UnauthorizedException(message);
  }

  async verifyEmail(token: string): Promise<{ approval_required: true; email: string }> {
    let payload: { sub?: string; orgId?: string; purpose?: string };
    try {
      payload = this.jwt.verify(token, { secret: process.env.EMAIL_VERIFICATION_SECRET || process.env.JWT_SECRET || 'change-me-user-secret' });
    } catch {
      throw new UnauthorizedException('Verification link is invalid or expired');
    }
    if (payload.purpose !== 'verify-email' || !payload.sub || !payload.orgId) throw new UnauthorizedException('Verification link is invalid');
    const membership = await this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId: payload.sub, orgId: payload.orgId } }, include: { user: { select: { email: true, emailVerifiedAt: true } } } });
    if (!membership) throw new UnauthorizedException('Verification account no longer exists');
    if (membership.user.emailVerifiedAt) throw new UnauthorizedException('Verification link has already been used');
    await this.prisma.user.update({ where: { id: payload.sub }, data: { emailVerifiedAt: new Date() } });
    return { approval_required: true, email: membership.user.email };
  }

  async resendVerification(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { userOrgs: { take: 1 } },
    });
    if (!user || user.emailVerifiedAt || !user.userOrgs[0]) return { ok: true };
    if (user.emailVerificationSentAt && Date.now() - user.emailVerificationSentAt.getTime() < 60_000) return { ok: true };
    if (!await this.mailgun.isConfigured(user.userOrgs[0].orgId)) return { ok: true };
    await this.sendVerification(user.id, user.userOrgs[0].orgId, user.email, user.name);
    return { ok: true };
  }

  private async sendVerification(userId:string,orgId:string,email:string,name:string|null) {
    const token=this.jwt.sign({sub:userId,orgId,purpose:'verify-email'},{secret:process.env.EMAIL_VERIFICATION_SECRET||process.env.JWT_SECRET||'change-me-user-secret',expiresIn:'24h'});
    const publicUrl=(process.env.PUBLIC_WEB_URL||'http://localhost:3000').replace(/\/$/,'');
    await this.mailgun.sendVerification(orgId,email,name,`${publicUrl}/verify-email?token=${encodeURIComponent(token)}`);
    await this.prisma.user.update({where:{id:userId},data:{emailVerificationSentAt:new Date()}});
  }

  /**
   * Get the user's profile including all org memberships.
   */
  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userOrgs: {
          include: { org: true, role: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      approved: Boolean(user.approvedAt),
      orgs: user.userOrgs.map((uo) => ({
        orgId: uo.orgId,
        orgName: uo.org.name,
        orgSlug: uo.org.slug,
        role: uo.role.name,
      })),
    };
  }

  /**
   * Find the first org or create a "Default" org.
   */
  async getOrCreateDefaultOrg(): Promise<{ id: string; name: string; slug: string }> {
    const existing = await this.prisma.org.findFirst({ orderBy: { createdAt: 'asc' } });
    if (existing) return existing;

    return this.prisma.org.create({
      data: { name: 'Default', slug: 'default' },
    });
  }

  private issueToken(userId: string, orgId: string, authVersion: number): string {
    return this.jwt.sign(
      { sub: userId, orgId, ver: authVersion },
      { secret: process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '12h' },
    );
  }

  private async resolveRole(name: string): Promise<{ id: string; name: string }> {
    let role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      // Create the role if it doesn't exist (dev/test convenience)
      role = await this.prisma.role.create({ data: { name } });
    }
    return role;
  }
}
