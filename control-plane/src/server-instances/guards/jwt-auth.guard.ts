import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

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
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const auth = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET || 'change-me-user-secret',
      });
      req.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
