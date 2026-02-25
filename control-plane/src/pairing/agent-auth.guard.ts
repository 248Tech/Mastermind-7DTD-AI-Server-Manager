import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { PairingService } from './pairing.service';

/** Request after AgentAuthGuard: agentHostId is set from verified JWT (trusted). */
export interface RequestWithAgent extends Request {
  agentHostId?: string;
}

/**
 * Verifies Bearer token as agent JWT (from pairing) and sets request.agentHostId from payload.sub.
 * Use on agent endpoints so hostId is trusted; do not rely on path params for host identity.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly pairingService: PairingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAgent>();
    const auth = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }
    const payload = await this.pairingService.verifyAgentKey(token);
    req.agentHostId = payload.sub;
    return true;
  }
}
