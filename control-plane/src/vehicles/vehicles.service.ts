import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PrismaCoreService } from '../prismacore/prismacore.service';
import { JobsService } from '../jobs/jobs.service';
import { ownedByPlayer } from '../player-auth/player-places';
import { buildGivePlusCommand } from '../donations/shop-grants';
import {
  describeVehicle,
  grantSucceeded,
  parseServerToolsVehicleList,
  teleportSucceeded,
  type VehicleSpec,
} from './vehicle-catalog';

const RETURN_COOLDOWN_MS = 10 * 60_000;
const RETURN_DAILY_LIMIT = 6;
const HISTORY_LIMIT = 12;

type Marker = {
  name?: string;
  steamId?: unknown;
  eosId?: unknown;
  extra?: unknown;
  position?: { x: number; y: number; z: number };
};

@Injectable()
export class VehiclesService {
  private readonly log = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaCore: PrismaCoreService,
    @Inject(forwardRef(() => JobsService)) private readonly jobs: JobsService,
  ) {}

  async captureServerVehicles(serverInstanceId: string) {
    const layer = await this.prismaCore.layer('vehicles') as { reachable?: boolean; markers?: Marker[] };
    if (!layer.reachable || !Array.isArray(layer.markers) || !layer.markers.length) return;
    const players = await this.prisma.player.findMany({
      where: { serverInstanceId, OR: [{ steamId: { not: null } }, { eosId: { not: null } }] },
      select: { id: true, steamId: true, eosId: true },
    });
    if (!players.length) return;
    const now = new Date();
    for (const marker of layer.markers) {
      const spec = describeVehicle(typeof marker.name === 'string' ? marker.name : '');
      if (!spec) continue;
      const owner = players.find((player) => ownedByPlayer(marker, player));
      if (!owner) continue;
      const position = marker.position;
      await this.prisma.playerVehicleHistory.upsert({
        where: { playerId_vehicleKey: { playerId: owner.id, vehicleKey: spec.key } },
        create: {
          playerId: owner.id,
          vehicleKey: spec.key,
          itemName: spec.itemName,
          displayName: spec.label,
          lastPosX: position?.x,
          lastPosY: position?.y,
          lastPosZ: position?.z,
          lastSeenAt: now,
        },
        update: {
          itemName: spec.itemName,
          displayName: spec.label,
          lastPosX: position?.x,
          lastPosY: position?.y,
          lastPosZ: position?.z,
          lastSeenAt: now,
        },
      });
    }
  }

  async historyForPlayer(
    playerId: string,
    live: Array<{ vehicleKey: string }>,
  ) {
    const rows = await this.prisma.playerVehicleHistory.findMany({
      where: { playerId },
      orderBy: { lastSeenAt: 'desc' },
      take: HISTORY_LIMIT,
    });
    const liveKeys = new Set(live.map((row) => row.vehicleKey));
    return rows
      .filter((row) => !liveKeys.has(row.vehicleKey))
      .map((row) => ({
        id: `history:${row.vehicleKey}`,
        vehicleKey: row.vehicleKey,
        name: row.displayName,
        position: {
          x: row.lastPosX ?? 0,
          y: row.lastPosY ?? 0,
          z: row.lastPosZ ?? 0,
        },
        live: false,
        lastSeenAt: row.lastSeenAt.toISOString(),
      }));
  }

  async returnVehicle(
    player: {
      id: string;
      orgId: string;
      serverInstanceId: string;
      steamId: string | null;
      entityId: number | null;
      online: boolean;
    },
    vehicleKeyRaw: string,
  ) {
    if (!player.online || !player.entityId) {
      throw new BadRequestException('Join the server before returning a vehicle');
    }
    const spec = describeVehicle(vehicleKeyRaw);
    if (!spec) throw new BadRequestException('Choose a bicycle, minibike, motorcycle, 4x4, or gyrocopter');
    const history = await this.prisma.playerVehicleHistory.findUnique({
      where: { playerId_vehicleKey: { playerId: player.id, vehicleKey: spec.key } },
    });
    this.assertReturnAllowed(history);
    await this.captureServerVehicles(player.serverInstanceId).catch((error) => this.log.debug(String(error)));

    let listed: ReturnType<typeof parseServerToolsVehicleList> = [];
    try {
      listed = await this.listWorldVehicles(player.orgId, player.serverInstanceId);
    } catch (error) {
      this.log.warn(`Vehicle list failed: ${error instanceof Error ? error.message : error}`);
    }
    const owned = listed.filter((row) => row.ownerEntityId === player.entityId);
    const liveMatch = owned.find((row) => describeVehicle(row.type)?.key === spec.key) ?? null;

    if (liveMatch?.occupied) {
      throw new BadRequestException('That vehicle is currently in use');
    }
    if (liveMatch) {
      const moved = await this.teleportVehicle(player.orgId, player.serverInstanceId, liveMatch.entityId, player.entityId);
      if (moved) {
        await this.markReturned(player.id, spec, liveMatch.entityId);
        return { ok: true, method: 'teleported', message: `Your ${spec.label.toLowerCase()} was brought to you.` };
      }
    }

    const granted = await this.spawnReplacement(player.orgId, player.serverInstanceId, player.steamId, spec);
    if (!granted) throw new ServiceUnavailableException('Could not return or replace that vehicle right now');
    await this.markReturned(player.id, spec, liveMatch?.entityId ?? history?.entityId);
    return { ok: true, method: 'spawned', message: `Your ${spec.label.toLowerCase()} could not be found in the world, so a replacement was added to your inventory.` };
  }

  private assertReturnAllowed(history: { lastReturnedAt: Date | null; returnCount: number } | null) {
    if (!history?.lastReturnedAt) return;
    const elapsed = Date.now() - history.lastReturnedAt.getTime();
    if (elapsed < RETURN_COOLDOWN_MS) {
      const minutes = Math.max(1, Math.ceil((RETURN_COOLDOWN_MS - elapsed) / 60_000));
      throw new BadRequestException(`Wait ${minutes} more minute${minutes === 1 ? '' : 's'} before returning another vehicle`);
    }
    const count = elapsed > 24 * 60 * 60_000 ? 0 : history.returnCount;
    if (count >= RETURN_DAILY_LIMIT) {
      throw new BadRequestException('Vehicle return is limited to 6 uses per day');
    }
  }

  private async listWorldVehicles(orgId: string, serverInstanceId: string) {
    const output = await this.runGameCommand(orgId, serverInstanceId, 'st-vl', 20_000);
    return parseServerToolsVehicleList(output);
  }

  private async teleportVehicle(orgId: string, serverInstanceId: string, vehicleEntityId: number, playerEntityId: number) {
    const output = await this.runGameCommand(orgId, serverInstanceId, `st-et ${vehicleEntityId} ${playerEntityId}`, 20_000);
    return teleportSucceeded(output);
  }

  private async spawnReplacement(orgId: string, serverInstanceId: string, steamId: string | null, spec: VehicleSpec) {
    const command = buildGivePlusCommand(steamId, spec.itemName, 1);
    if (!command) return false;
    const output = await this.runGameCommand(orgId, serverInstanceId, command, 20_000);
    return grantSucceeded(output);
  }

  private async runGameCommand(orgId: string, serverInstanceId: string, command: string, timeoutMs: number) {
    const queued = await this.jobs.enqueueInternalJob(orgId, null, serverInstanceId, 'RCON', {
      command,
      purpose: 'vehicle_return',
    });
    return this.jobs.waitForJobOutput(queued.jobRunId, timeoutMs);
  }

  private async markReturned(playerId: string, spec: VehicleSpec, entityId?: number | null) {
    const recent = await this.prisma.playerVehicleHistory.findUnique({
      where: { playerId_vehicleKey: { playerId, vehicleKey: spec.key } },
    });
    const reset = !recent?.lastReturnedAt || Date.now() - recent.lastReturnedAt.getTime() > 24 * 60 * 60_000;
    await this.prisma.playerVehicleHistory.upsert({
      where: { playerId_vehicleKey: { playerId, vehicleKey: spec.key } },
      create: {
        playerId,
        vehicleKey: spec.key,
        itemName: spec.itemName,
        displayName: spec.label,
        entityId: entityId ?? undefined,
        lastSeenAt: new Date(),
        lastReturnedAt: new Date(),
        returnCount: 1,
      },
      update: {
        itemName: spec.itemName,
        displayName: spec.label,
        entityId: entityId ?? undefined,
        lastReturnedAt: new Date(),
        returnCount: reset ? 1 : { increment: 1 },
      },
    });
  }
}
