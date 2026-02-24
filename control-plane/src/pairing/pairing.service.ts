import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreatePairingTokenDto } from './dto/create-pairing-token.dto';
import { PairRequestDto } from './dto/pair-request.dto';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';

const TOKEN_BYTES = 32;
const HASH_ALG = 'sha256';
const DEFAULT_EXPIRES_IN_SEC = 900;

export interface AgentJwtPayload {
  sub: string;   // hostId
  orgId: string;
  keyVersion: number;
  type: 'agent';
}

@Injectable()
export class PairingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Hash token for storage and lookup. Never store plaintext.
   */
  private hashToken(plain: string): string {
    return createHash(HASH_ALG).update(plain, 'utf8').digest('hex');
  }

  /**
   * Admin: generate a single-use pairing token for the org.
   * Returns plaintext token once; caller must pass to agent out-of-band.
   */
  async createToken(
    orgId: string,
    userId: string,
    dto: CreatePairingTokenDto,
  ): Promise<{ id: string; token: string; expiresAt: Date; expiresInSec: number }> {
    const expiresInSec = dto.expiresInSec ?? DEFAULT_EXPIRES_IN_SEC;
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);
    const plainToken = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = this.hashToken(plainToken);

    const record = await this.prisma.pairingToken.create({
      data: {
        orgId,
        tokenHash,
        expiresAt,
        createdById: userId,
      },
    });

    return {
      id: record.id,
      token: plainToken,
      expiresAt,
      expiresInSec,
    };
  }

  /**
   * Agent: validate token and complete pairing. Creates host, issues signed agent key, marks token used, audits.
   */
  async pair(dto: PairRequestDto, clientIp?: string): Promise<{ hostId: string; agentKey: string }> {
    const tokenHash = this.hashToken(dto.pairingToken.trim());

    const tokenRecord = await this.prisma.pairingToken.findFirst({
      where: { tokenHash },
      include: { org: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid pairing token');
    }

    if (tokenRecord.usedAt) {
      throw new BadRequestException('Pairing token already used');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException('Pairing token expired');
    }

    const name = dto.hostMetadata?.name?.trim() || `Host ${new Date().toISOString().slice(0, 19)}`;

    const host = await this.prisma.host.create({
      data: {
        orgId: tokenRecord.orgId,
        name,
        agentKeyVersion: 1,
      },
    });

    await this.prisma.pairingToken.update({
      where: { id: tokenRecord.id },
      data: {
        usedAt: new Date(),
        usedByHostId: host.id,
      },
    });

    const agentKey = this.signAgentKey(host.id, tokenRecord.orgId, host.agentKeyVersion);

    await this.prisma.auditLog.create({
      data: {
        orgId: tokenRecord.orgId,
        actorId: null,
        action: 'agent_pair',
        resourceType: 'host',
        resourceId: host.id,
        details: {
          pairingTokenId: tokenRecord.id,
          hostName: name,
          clientIp,
        },
        ip: clientIp,
      },
    });

    return { hostId: host.id, agentKey };
  }

  /**
   * Issue a signed JWT for the agent. Include keyVersion for rotation support.
   */
  signAgentKey(hostId: string, orgId: string, keyVersion: number): string {
    const payload: AgentJwtPayload = {
      sub: hostId,
      orgId,
      keyVersion,
      type: 'agent',
    };
    return this.jwt.sign(payload, {
      subject: hostId,
      jwtid: String(keyVersion),
    });
  }

  /**
   * Verify agent JWT and return payload. Guard should also check host.agentKeyVersion === payload.keyVersion for rotation.
   */
  async verifyAgentKey(token: string): Promise<AgentJwtPayload> {
    try {
      const payload = this.jwt.verify<AgentJwtPayload>(token);
      if (payload.type !== 'agent' || !payload.sub || !payload.orgId) {
        throw new UnauthorizedException('Invalid agent token');
      }
      const host = await this.prisma.host.findUnique({
        where: { id: payload.sub },
      });
      if (!host || host.orgId !== payload.orgId) {
        throw new UnauthorizedException('Host not found or org mismatch');
      }
      if (host.agentKeyVersion !== payload.keyVersion) {
        throw new UnauthorizedException('Agent key was rotated; re-pair or use new key');
      }
      return payload;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired agent token');
    }
  }

  /**
   * Rotate agent key for a host (invalidate current key; next heartbeat or call can use new key after re-issue).
   * Caller must be authorized for this org/host.
   */
  async rotateAgentKey(orgId: string, hostId: string): Promise<{ agentKey: string }> {
    const host = await this.prisma.host.findFirst({
      where: { id: hostId, orgId },
    });
    if (!host) {
      throw new ForbiddenException('Host not found or access denied');
    }

    const newVersion = host.agentKeyVersion + 1;
    await this.prisma.host.update({
      where: { id: hostId },
      data: { agentKeyVersion: newVersion },
    });

    const agentKey = this.signAgentKey(hostId, orgId, newVersion);
    return { agentKey };
  }
}
