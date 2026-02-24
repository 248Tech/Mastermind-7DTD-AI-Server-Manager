import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';

export const ORG_ROLE_KEY = 'orgRole';

/** Request after JWT + this guard: user.id set, orgId from param, orgRole = 'admin' | 'operator' | 'viewer'. */
export interface RequestWithOrgRole {
  user?: { id: string };
  params?: { orgId?: string };
  [ORG_ROLE_KEY]?: string;
}

/**
 * Loads user's role in the org from param. User must be in org (UserOrg); attaches role name to request.
 * Use after JwtAuthGuard so request.user.id is set.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithOrgRole>();
    const orgId = req.params?.orgId;
    const userId = req.user?.id;
    if (!orgId || !userId) {
      throw new ForbiddenException('Unauthorized');
    }
    const userOrg = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: { role: true },
    });
    if (!userOrg) {
      throw new ForbiddenException('Not a member of this org');
    }
    req[ORG_ROLE_KEY] = userOrg.role.name;
    return true;
  }
}
