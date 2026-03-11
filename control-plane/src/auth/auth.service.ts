import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { createHash, randomBytes } from 'crypto';

const SALT_BYTES = 16;

function generateSalt(): string {
  return randomBytes(SALT_BYTES).toString('hex');
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(salt + password).digest('hex');
}

function makePasswordHash(password: string): string {
  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
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
  ) {}

  /**
   * Register a new user. Optionally associate with an org (defaults to the default org).
   * The first user in an org is granted admin role; subsequent users get operator.
   */
  async register(
    email: string,
    password: string,
    name?: string,
    orgId?: string,
  ): Promise<{ access_token: string; userId: string; orgId: string }> {
    // Check for existing email
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const targetOrgId = orgId ?? (await this.getOrCreateDefaultOrg()).id;

    // Count existing members to determine role
    const memberCount = await this.prisma.userOrg.count({ where: { orgId: targetOrgId } });
    const roleName = memberCount === 0 ? 'admin' : 'operator';
    const role = await this.resolveRole(roleName);

    const passwordHash = makePasswordHash(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        name: name?.trim() || null,
        passwordHash,
        userOrgs: {
          create: {
            orgId: targetOrgId,
            roleId: role.id,
          },
        },
      },
    });

    const access_token = this.issueToken(user.id, targetOrgId);
    return { access_token, userId: user.id, orgId: targetOrgId };
  }

  /**
   * Login with email and password. Returns JWT and user/org info.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ access_token: string; userId: string; orgId: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userOrgs: { include: { org: true }, take: 1 } },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // Use the first org the user belongs to
    const firstOrgId = user.userOrgs[0]?.orgId ?? (await this.getOrCreateDefaultOrg()).id;

    const access_token = this.issueToken(user.id, firstOrgId);
    return { access_token, userId: user.id, orgId: firstOrgId };
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

  private issueToken(userId: string, orgId: string): string {
    return this.jwt.sign(
      { sub: userId, orgId },
      { secret: process.env.JWT_SECRET || 'change-me-user-secret', expiresIn: '7d' },
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
