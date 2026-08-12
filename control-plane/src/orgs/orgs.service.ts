import { Injectable, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { makePasswordHash } from '../auth/auth.service';

@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

  getProfileEditorCredit(orgId: string) {
    return {
      orgId,
      name: '7 Days to Die TTP Profile Editor',
      upstreamAuthor: 'RussDev7 / DannyRuss',
      upstreamRepository: 'https://github.com/RussDev7/7D2DProfileEditor',
      upstreamCommit: '270f998adf70f3724afd93ba0e08569e3ba78c95',
      license: 'GNU GPL v3',
      acknowledgements: ['kani-momonga/7DaysProfileEditorPHP', 'Karlovsky120/7DaysProfileEditor'],
      integration: 'Isolated upstream service proxied by Mastermind; source profiles are never overwritten automatically.',
    };
  }

  async getAccounts(orgId: string) {
    const memberships = await this.prisma.userOrg.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, name: true, createdAt: true } }, role: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(membership => ({
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role.name,
      createdAt: membership.user.createdAt,
    }));
  }

  async createAccount(orgId: string, input: { email: string; password: string; name?: string; role: 'operator' | 'viewer' }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const role = await this.resolveRole(input.role);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name?.trim() || null,
        passwordHash: makePasswordHash(input.password),
        userOrgs: { create: { orgId, roleId: role.id } },
      },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    return { ...user, role: role.name };
  }

  async deleteAccount(orgId: string, accountId: string, actingUserId: string) {
    if (accountId === actingUserId) throw new ForbiddenException('You cannot delete your own account');
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId: accountId, orgId } },
      include: { role: true, user: { select: { email: true, _count: { select: { userOrgs: true } } } } },
    });
    if (!membership) throw new NotFoundException('Organization account not found');
    if (membership.role.name === 'admin') {
      const adminRole = await this.prisma.role.findUnique({ where: { name: 'admin' }, select: { id: true } });
      const adminCount = adminRole ? await this.prisma.userOrg.count({ where: { orgId, roleId: adminRole.id } }) : 0;
      if (adminCount <= 1) throw new ConflictException('The organization must keep at least one administrator');
    }
    await this.prisma.$transaction(async tx => {
      await tx.userServerRole.deleteMany({ where: { userId: accountId, serverInstance: { orgId } } });
      await tx.userOrg.delete({ where: { userId_orgId: { userId: accountId, orgId } } });
      if (membership.user._count.userOrgs === 1) {
        await tx.user.update({ where: { id: accountId }, data: { passwordHash: null } });
      }
    });
    return { ok: true, email: membership.user.email, signInDisabled: membership.user._count.userOrgs === 1 };
  }

  async createOrg(
    name: string,
    slug: string,
    userId: string,
  ): Promise<{ id: string; name: string; slug: string; role: string }> {
    const existing = await this.prisma.org.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException(`An org with slug "${slug}" already exists`);
    }

    const adminRole = await this.resolveRole('admin');

    const org = await this.prisma.org.create({
      data: {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        userOrgs: {
          create: {
            userId,
            roleId: adminRole.id,
          },
        },
      },
    });

    return { id: org.id, name: org.name, slug: org.slug, role: 'admin' };
  }

  async getOrg(orgId: string, userId: string) {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: {
        org: {
          include: {
            _count: { select: { userOrgs: true, hosts: true, serverInstances: true } },
          },
        },
        role: true,
      },
    });

    if (!userOrg) {
      throw new ForbiddenException('Not a member of this org');
    }

    return {
      id: userOrg.org.id,
      name: userOrg.org.name,
      slug: userOrg.org.slug,
      discordWebhookUrl: userOrg.org.discordWebhookUrl,
      frigateUrl: userOrg.org.frigateUrl,
      frigateApiKey: userOrg.org.frigateApiKey,
      frigateWebhookSecret: userOrg.org.frigateWebhookSecret,
      avoidBloodMoonRestart: userOrg.org.avoidBloodMoonRestart,
      createdAt: userOrg.org.createdAt,
      updatedAt: userOrg.org.updatedAt,
      memberCount: userOrg.org._count.userOrgs,
      hostCount: userOrg.org._count.hosts,
      serverInstanceCount: userOrg.org._count.serverInstances,
      userRole: userOrg.role.name,
    };
  }

  async getUserOrgs(userId: string) {
    const memberships = await this.prisma.userOrg.findMany({
      where: { userId },
      include: {
        org: {
          include: {
            _count: { select: { userOrgs: true, hosts: true, serverInstances: true } },
          },
        },
        role: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      discordWebhookUrl: m.org.discordWebhookUrl,
      frigateUrl: m.org.frigateUrl,
      frigateApiKey: m.org.frigateApiKey,
      frigateWebhookSecret: m.org.frigateWebhookSecret,
      avoidBloodMoonRestart: m.org.avoidBloodMoonRestart,
      createdAt: m.org.createdAt,
      updatedAt: m.org.updatedAt,
      memberCount: m.org._count.userOrgs,
      hostCount: m.org._count.hosts,
      serverInstanceCount: m.org._count.serverInstances,
      role: m.role.name,
    }));
  }

  async updateOrg(
    orgId: string,
    userId: string,
    updates: { discordWebhookUrl?: string; frigateUrl?: string; frigateApiKey?: string; frigateWebhookSecret?: string; avoidBloodMoonRestart?: boolean },
  ): Promise<{ ok: true; avoidBloodMoonRestart: boolean }> {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { role: true },
    });
    if (!userOrg) throw new ForbiddenException('Not a member of this org');
    if (updates.avoidBloodMoonRestart !== undefined && userOrg.role.name !== 'admin') {
      throw new ForbiddenException('Only organization administrators may change restart protection');
    }

    const data: Record<string, string | null | boolean> = {};
    if (updates.discordWebhookUrl !== undefined) data.discordWebhookUrl = updates.discordWebhookUrl || null;
    if (updates.frigateUrl !== undefined) data.frigateUrl = updates.frigateUrl || null;
    if (updates.frigateApiKey !== undefined) data.frigateApiKey = updates.frigateApiKey || null;
    if (updates.frigateWebhookSecret !== undefined) data.frigateWebhookSecret = updates.frigateWebhookSecret || null;
    if (updates.avoidBloodMoonRestart !== undefined) data.avoidBloodMoonRestart = updates.avoidBloodMoonRestart;

    const org = await this.prisma.org.update({ where: { id: orgId }, data });
    return { ok: true, avoidBloodMoonRestart: org.avoidBloodMoonRestart };
  }

  async testFrigateConnection(
    orgId: string,
    userId: string,
  ): Promise<{ ok: boolean; version?: string; error?: string }> {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { org: { select: { frigateUrl: true, frigateApiKey: true } } },
    });
    if (!userOrg) throw new ForbiddenException('Not a member of this org');

    const frigateUrl = userOrg.org.frigateUrl?.trim();
    if (!frigateUrl) {
      return { ok: false, error: 'No Frigate URL configured for this org' };
    }

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (userOrg.org.frigateApiKey) headers.Authorization = `Bearer ${userOrg.org.frigateApiKey}`;

      const res = await fetch(`${frigateUrl}/api/version`, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        return { ok: false, error: `Frigate returned HTTP ${res.status}` };
      }
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: true, version: String(body.version ?? body.Version ?? 'unknown') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async resolveRole(name: string): Promise<{ id: string; name: string }> {
    let role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      role = await this.prisma.role.create({ data: { name } });
    }
    return role;
  }
}
