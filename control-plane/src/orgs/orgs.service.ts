import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class OrgsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new org and add the requesting user as admin.
   */
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

  /**
   * Get org details if the user is a member.
   */
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
      createdAt: userOrg.org.createdAt,
      updatedAt: userOrg.org.updatedAt,
      memberCount: userOrg.org._count.userOrgs,
      hostCount: userOrg.org._count.hosts,
      serverInstanceCount: userOrg.org._count.serverInstances,
      userRole: userOrg.role.name,
    };
  }

  /**
   * List all orgs the user is a member of, with their role.
   */
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
      createdAt: m.org.createdAt,
      updatedAt: m.org.updatedAt,
      memberCount: m.org._count.userOrgs,
      hostCount: m.org._count.hosts,
      serverInstanceCount: m.org._count.serverInstances,
      role: m.role.name,
    }));
  }

  private async resolveRole(name: string): Promise<{ id: string; name: string }> {
    let role = await this.prisma.role.findUnique({ where: { name } });
    if (!role) {
      role = await this.prisma.role.create({ data: { name } });
    }
    return role;
  }
}
