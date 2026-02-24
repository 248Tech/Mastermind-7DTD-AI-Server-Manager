import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateServerInstanceDto } from './dto/create-server-instance.dto';
import { UpdateServerInstanceDto } from './dto/update-server-instance.dto';

const GAME_TYPE_SLUG_7DTD = '7dtd';

@Injectable()
export class ServerInstancesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve game type id from slug (e.g. 7dtd, minecraft). */
  private async getGameTypeIdBySlug(slug: string): Promise<string> {
    const gt = await this.prisma.gameType.findFirst({
      where: { slug: slug.toLowerCase() },
    });
    if (!gt) {
      throw new BadRequestException(
        `Game type "${slug}" is not registered. Seed game_types with slug "${slug}".`,
      );
    }
    return gt.id;
  }

  private async get7DtdGameTypeId(): Promise<string> {
    return this.getGameTypeIdBySlug(GAME_TYPE_SLUG_7DTD);
  }

  /** Resolve host belongs to org (single-host MVP). */
  private async assertHostInOrg(hostId: string, orgId: string): Promise<void> {
    const host = await this.prisma.host.findFirst({
      where: { id: hostId, orgId },
    });
    if (!host) {
      throw new BadRequestException('Host not found or does not belong to this org');
    }
  }

  async findAll(orgId: string) {
    const list = await this.prisma.serverInstance.findMany({
      where: { orgId },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((row) => this.toResponse(row, false));
  }

  async findOne(orgId: string, id: string, includePassword = false) {
    const row = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });
    if (!row) {
      throw new NotFoundException('Server instance not found');
    }
    return this.toResponse(row, includePassword);
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateServerInstanceDto,
    clientIp?: string,
  ) {
    await this.assertHostInOrg(dto.hostId, orgId);
    const gameTypeId = await this.getGameTypeIdBySlug(dto.gameType);

    const created = await this.prisma.serverInstance.create({
      data: {
        orgId,
        hostId: dto.hostId,
        gameTypeId,
        name: dto.name.trim(),
        installPath: dto.installPath?.trim() || null,
        startCommand: dto.startCommand?.trim() || null,
        telnetHost: dto.telnetHost?.trim() || null,
        telnetPort: dto.telnetPort ?? null,
        telnetPassword: dto.telnetPassword ?? null,
      },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });

    await this.audit(orgId, userId, 'create', created.id, {
      name: created.name,
      hostId: created.hostId,
      gameType: created.gameType?.slug ?? dto.gameType,
    }, clientIp);

    return this.toResponse(created, true);
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    dto: UpdateServerInstanceDto,
    clientIp?: string,
  ) {
    const existing = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new NotFoundException('Server instance not found');
    }
    if (dto.hostId !== undefined) {
      await this.assertHostInOrg(dto.hostId, orgId);
    }

    const gameTypeId = dto.gameType ? await this.getGameTypeIdBySlug(dto.gameType) : undefined;
    const updated = await this.prisma.serverInstance.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.hostId !== undefined && { hostId: dto.hostId }),
        ...(gameTypeId && { gameTypeId }),
        ...(dto.installPath !== undefined && { installPath: dto.installPath?.trim() || null }),
        ...(dto.startCommand !== undefined && { startCommand: dto.startCommand?.trim() || null }),
        ...(dto.telnetHost !== undefined && { telnetHost: dto.telnetHost?.trim() || null }),
        ...(dto.telnetPort !== undefined && { telnetPort: dto.telnetPort ?? null }),
        ...(dto.telnetPassword !== undefined && { telnetPassword: dto.telnetPassword ?? null }),
      },
      include: { host: true, gameType: { select: { slug: true, capabilities: true } } },
    });

    await this.audit(orgId, userId, 'update', id, {
      updated: Object.keys(dto).filter((k) => k !== 'telnetPassword'),
    }, clientIp);

    return this.toResponse(updated, true);
  }

  async remove(orgId: string, userId: string, id: string, clientIp?: string) {
    const existing = await this.prisma.serverInstance.findFirst({
      where: { id, orgId },
    });
    if (!existing) {
      throw new NotFoundException('Server instance not found');
    }

    await this.prisma.serverInstance.delete({ where: { id } });
    await this.audit(orgId, userId, 'delete', id, { name: existing.name }, clientIp);
    return { deleted: true, id };
  }

  private toResponse(
    row: {
      id: string;
      orgId: string;
      hostId: string;
      gameTypeId: string;
      name: string;
      installPath: string | null;
      startCommand: string | null;
      telnetHost: string | null;
      telnetPort: number | null;
      telnetPassword: string | null;
      createdAt: Date;
      updatedAt: Date;
      gameType?: { slug: string; capabilities: unknown };
    },
    includePassword: boolean,
  ) {
    const capabilities = Array.isArray(row.gameType?.capabilities)
      ? (row.gameType.capabilities as string[])
      : [];
    const out: Record<string, unknown> = {
      id: row.id,
      orgId: row.orgId,
      hostId: row.hostId,
      gameTypeId: row.gameTypeId,
      gameType: row.gameType?.slug ?? '7dtd',
      capabilities,
      name: row.name,
      installPath: row.installPath,
      startCommand: row.startCommand,
      telnetHost: row.telnetHost,
      telnetPort: row.telnetPort,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    if (includePassword) {
      out.telnetPassword = row.telnetPassword;
    }
    return out;
  }

  private async audit(
    orgId: string,
    actorId: string,
    action: string,
    resourceId: string,
    details: Record<string, unknown>,
    ip?: string,
  ) {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        action,
        resourceType: 'server_instance',
        resourceId,
        details,
        ip,
      },
    });
  }
}
