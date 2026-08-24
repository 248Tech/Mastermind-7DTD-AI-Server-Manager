import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';

/** Request after this guard: user = { id: string } from JWT sub. */
export interface RequestWithUser extends Request {
  user?: { id: string };
}

/**
 * Verifies Bearer JWT and sets request.user.id from payload.sub.
 * Use JWT_SECRET for user tokens (distinct from agent secret).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const auth = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    try {
      const payload = this.jwt.verify<{ sub: string; ver?: number }>(token, {
        secret: process.env.JWT_SECRET || 'change-me-user-secret',
      });
      if (!payload.sub || !Number.isInteger(payload.ver)) throw new Error('Invalid token claims');
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { approvedAt: true, passwordHash: true, authVersion: true },
      });
      if (!user?.approvedAt || !user.passwordHash || user.authVersion !== payload.ver) {
        throw new Error('Account access revoked');
      }
      req.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
