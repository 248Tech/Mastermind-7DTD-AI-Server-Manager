import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { PairingService } from './pairing.service';
import { CreatePairingTokenDto } from './dto/create-pairing-token.dto';
import { PairRequestDto } from './dto/pair-request.dto';
import { PairResponseDto } from './dto/pair-response.dto';
import { PairingTokenResponseDto } from './dto/pairing-token-response.dto';

/** Stub: replace with your JWT strategy + org admin check (e.g. RolesGuard + orgId from param). */
@Injectable()
class JwtAuthGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

@Injectable()
class OrgAdminGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    return true;
  }
}

/** Request with optional user and org from auth */
interface RequestWithOrg {
  user?: { id: string };
  orgId?: string;
}

/**
 * Pairing controller:
 * - POST /api/orgs/:orgId/pairing-tokens (admin): generate token
 * - POST /api/agent/pair (public): agent presents token, receives signed key
 * - POST /api/orgs/:orgId/hosts/:hostId/rotate-key (admin): rotate agent key
 */
@Controller()
export class PairingController {
  constructor(private readonly pairingService: PairingService) {}

  /**
   * Admin: create a pairing token for the org.
   * Require: JWT + org membership + admin/operator role.
   */
  @Post('api/orgs/:orgId/pairing-tokens')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  async createToken(
    @Param('orgId') orgId: string,
    @Body() dto: CreatePairingTokenDto,
    @Req() req: RequestWithOrg,
  ): Promise<PairingTokenResponseDto> {
    const userId = req.user!.id;
    const result = await this.pairingService.createToken(orgId, userId, dto);
    return {
      id: result.id,
      token: result.token,
      expiresAt: result.expiresAt,
      expiresInSec: result.expiresInSec,
    };
  }

  /**
   * Agent: pair with control plane using a one-time token.
   * No auth; rate-limit by IP in production.
   */
  @Post('api/agent/pair')
  @HttpCode(HttpStatus.OK)
  async pair(
    @Body() dto: PairRequestDto,
    @Req() req: { ip?: string; headers?: { 'x-forwarded-for'?: string } },
  ): Promise<PairResponseDto> {
    const clientIp = (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const result = await this.pairingService.pair(dto, clientIp);
    return {
      hostId: result.hostId,
      agentKey: result.agentKey,
    };
  }

  /**
   * Admin: rotate agent key for a host. Returns new key (display once; agent must re-fetch or use new key from separate channel).
   */
  @Post('api/orgs/:orgId/hosts/:hostId/rotate-key')
  @UseGuards(JwtAuthGuard, OrgAdminGuard)
  async rotateKey(
    @Param('orgId') orgId: string,
    @Param('hostId') hostId: string,
  ): Promise<{ agentKey: string }> {
    return this.pairingService.rotateAgentKey(orgId, hostId);
  }
}
