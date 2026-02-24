import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestWithOrgRole, ORG_ROLE_KEY } from './org-member.guard';

export const REQUIRE_ORG_ROLES_KEY = 'requireOrgRoles';

/**
 * Requires request to have orgRole (set by OrgMemberGuard) in the allowed list.
 * Use for write operations: require ['admin', 'operator']; viewers get 403.
 */
@Injectable()
export class RequireOrgRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<string[]>(
      REQUIRE_ORG_ROLES_KEY,
      context.getHandler(),
    ) ?? ['admin', 'operator'];
    const req = context.switchToHttp().getRequest<RequestWithOrgRole>();
    const role = req[ORG_ROLE_KEY];
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient permissions (admin or operator required)');
    }
    return true;
  }
}

/** Use with @RequireOrgRoles('admin', 'operator') on write endpoints. */
export const RequireOrgRoles = (...roles: string[]) =>
  SetMetadata(REQUIRE_ORG_ROLES_KEY, roles);
