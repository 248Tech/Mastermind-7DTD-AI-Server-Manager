import { Injectable, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

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
    updates: { discordWebhookUrl?: string; frigateUrl?: string; frigateApiKey?: string; frigateWebhookSecret?: string },
  ): Promise<{ ok: true }> {
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { role: true },
    });
    if (!userOrg) throw new ForbiddenException('Not a member of this org');

    const data: Record<string, string | null> = {};
    if (updates.discordWebhookUrl !== undefined) data.discordWebhookUrl = updates.discordWebhookUrl || null;
    if (updates.frigateUrl !== undefined) data.frigateUrl = updates.frigateUrl || null;
    if (updates.frigateApiKey !== undefined) data.frigateApiKey = updates.frigateApiKey || null;
    if (updates.frigateWebhookSecret !== undefined) data.frigateWebhookSecret = updates.frigateWebhookSecret || null;

    await this.prisma.org.update({ where: { id: orgId }, data });
    return { ok: true };
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
