import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PairingService } from './pairing.service';
import { CreatePairingTokenDto } from './dto/create-pairing-token.dto';
import { PairRequestDto } from './dto/pair-request.dto';
import { PairResponseDto } from './dto/pair-response.dto';
import { PairingTokenResponseDto } from './dto/pairing-token-response.dto';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';

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
   * Require: JWT + org membership + admin role.
   */
  @Post('api/orgs/:orgId/pairing-tokens')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async createToken(
    @Param('orgId') orgId: string,
    @Body() dto: CreatePairingTokenDto,
    @Req() req: RequestWithUser,
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
    const normalizedDto: PairRequestDto = {
      ...dto,
      pairingToken: dto.pairingToken || dto.pairing_token || '',
      hostMetadata: dto.hostMetadata || dto.host_metadata,
    };
    const result = await this.pairingService.pair(normalizedDto, clientIp);
    return {
      hostId: result.hostId,
      agentKey: result.agentKey,
    };
  }

  /**
   * Admin: rotate agent key for a host. Returns new key (display once; agent must re-fetch or use new key from separate channel).
   */
  @Post('api/orgs/:orgId/hosts/:hostId/rotate-key')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async rotateKey(
    @Param('orgId') orgId: string,
    @Param('hostId') hostId: string,
  ): Promise<{ agentKey: string }> {
    return this.pairingService.rotateAgentKey(orgId, hostId);
  }
}
