import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';

const HEALTH_SAMPLE_RETENTION_MS = 48 * 60 * 60_000;
const HEALTH_SAMPLE_PRUNE_INTERVAL_MS = 5 * 60_000;
/** Minimum gap between automatic reboot-if-down starts for one server. */
const REBOOT_IF_DOWN_COOLDOWN_MS = 3 * 60_000;
const REBOOT_IF_DOWN_BLOCKING_JOBS = [
  'SERVER_START',
  'SERVER_RESTART',
  'SERVER_SAFE_RESTART',
  'SERVER_STOP',
  'SERVER_SAVE_STOP',
  'SERVER_UPDATE',
  'SERVER_MAINTENANCE',
  'SERVER_WIPE_SAVE',
  'SERVER_KILL',
];

export interface HeartbeatMetrics {
  cpu?: number;
  ramUsedMb?: number;
  ramTotalMb?: number;
  diskUsedGb?: number;
  latencyMs?: number;
  gameReachable?: boolean;
  agentVersion?: string;
}

@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);
  private readonly lastHealthSample = new Map<string, number>();
  private lastHealthPrune = 0;
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => JobsService)) private readonly jobsService: JobsService,
  ) {}

  /** List all hosts in the org with their server instance count. */
  async findAll(orgId: string) {
    const hosts = await this.prisma.host.findMany({
      where: { orgId },
      include: {
        serverInstances: { select: { id: true, name: true } },
        _count: { select: { serverInstances: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return hosts.map((h) => this.toResponse(h));
  }

  /** Get a single host with its server instances. */
  async findOne(orgId: string, hostId: string) {
    const host = await this.prisma.host.findFirst({
      where: { id: hostId, orgId },
      include: {
        serverInstances: {
          select: {
            id: true,
            name: true,
            hostId: true,
            gameTypeId: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        _count: { select: { serverInstances: true } },
      },
    });
    if (!host) {
      throw new NotFoundException('Host not found');
    }
    return this.toResponse(host);
  }

  async rename(orgId: string, hostId: string, name: string, userId: string) {
    const clean = name.trim();
    if (!clean || clean.length > 128) throw new BadRequestException('Host name must contain 1-128 characters');
    const host = await this.prisma.host.findFirst({ where: { id: hostId, orgId }, select: { id: true, name: true } });
    if (!host) throw new NotFoundException('Host not found');
    const updated = await this.prisma.host.update({ where: { id: hostId }, data: { name: clean } });
    await this.prisma.auditLog.create({ data: { orgId, actorId: userId, action: 'rename', resourceType: 'host', resourceId: hostId, details: { from: host.name, to: clean } } });
    return this.toResponse(updated);
  }

  async remove(orgId: string, hostId: string, userId: string) {
    const host = await this.prisma.host.findFirst({
      where: { id: hostId, orgId }, select: { id: true, name: true, _count: { select: { serverInstances: true } } },
    });
    if (!host) throw new NotFoundException('Host not found');
    if (host._count.serverInstances > 0) {
      throw new BadRequestException('Unregister this host’s server instances before deleting the host');
    }
    await this.prisma.$transaction([
      this.prisma.jobRun.deleteMany({ where: { hostId } }),
      this.prisma.auditLog.create({ data: { orgId, actorId: userId, action: 'delete', resourceType: 'host', resourceId: hostId, details: { name: host.name } } }),
      this.prisma.host.delete({ where: { id: hostId } }),
    ]);
  }

  /**
   * Record a heartbeat from an agent. Updates lastHeartbeatAt, lastMetrics, and status.
   * Returns { wasOffline: boolean } so callers can trigger alerts.
   */
  async recordHeartbeat(
    hostId: string,
    orgId: string,
    metrics?: HeartbeatMetrics,
  ): Promise<{ wasOffline: boolean; host: { id: string; name: string; orgId: string } }> {
    const existing = await this.prisma.host.findFirst({
      where: { id: hostId, orgId },
      select: { id: true, name: true, orgId: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException('Host not found or does not belong to this org');
    }

    const wasOffline = existing.status === 'offline' || existing.status === 'unknown';

    const metricsData: Record<string, unknown> = {};
    if (metrics) {
      if (metrics.cpu !== undefined) metricsData.cpu = metrics.cpu;
      if (metrics.ramUsedMb !== undefined) metricsData.ramUsedMb = metrics.ramUsedMb;
      if (metrics.ramTotalMb !== undefined) metricsData.ramTotalMb = metrics.ramTotalMb;
      if (metrics.diskUsedGb !== undefined) metricsData.diskUsedGb = metrics.diskUsedGb;
      if (metrics.latencyMs !== undefined) metricsData.latencyMs = metrics.latencyMs;
      if (metrics.gameReachable !== undefined) metricsData.gameReachable = metrics.gameReachable;
    }

    await this.prisma.host.update({
      where: { id: hostId },
      data: {
        lastHeartbeatAt: new Date(),
        status: 'online',
        lastMetrics: Object.keys(metricsData).length > 0
          ? (metricsData as Prisma.InputJsonValue)
          : undefined,
        ...(metrics?.agentVersion !== undefined && { agentVersion: metrics.agentVersion }),
      },
    });

    if (metrics) {
      const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { healthIntervalSec: true } });
      const now = Date.now();
      if (org && now - (this.lastHealthSample.get(hostId) ?? 0) >= org.healthIntervalSec * 1000) {
        this.lastHealthSample.set(hostId, now);
        await this.prisma.healthSample.create({ data: {
          orgId, hostId,
          cpuPercent: metrics.cpu ?? 0,
          ramUsedMb: metrics.ramUsedMb ?? 0,
          ramTotalMb: metrics.ramTotalMb ?? 0,
          diskUsedGb: metrics.diskUsedGb ?? 0,
          latencyMs: metrics.latencyMs ?? 0,
          gameReachable: metrics.gameReachable ?? false,
        }});
        await this.pruneHealthSamples(now);
      }
    }

    return { wasOffline, host: { id: existing.id, name: existing.name, orgId: existing.orgId } };
  }

  /**
   * Convenience wrapper for agent heartbeat: resolves orgId from the host record,
   * then delegates to recordHeartbeat. Use when only hostId is available (agent endpoint).
   */
  async recordHeartbeatByHostIdOnly(hostId: string, metrics?: HeartbeatMetrics): Promise<void> {
    const host = await this.prisma.host.findUnique({
      where: { id: hostId },
      select: { id: true, orgId: true },
    });
    if (!host) {
      throw new NotFoundException('Host not found');
    }
    await this.recordHeartbeat(hostId, host.orgId, metrics);
    if (metrics?.gameReachable === false) {
      await this.maybeRebootIfDown(hostId, host.orgId).catch((error) => {
        this.logger.warn(`reboot-if-down check failed for host ${hostId}: ${error instanceof Error ? error.message : error}`);
      });
    }
  }

  /**
   * When the game probe reports unreachable, start any servers on this host that
   * opted into reboot-if-down (and are not in maintenance).
   */
  private async maybeRebootIfDown(hostId: string, orgId: string): Promise<void> {
    const servers = await this.prisma.serverInstance.findMany({
      where: { hostId, orgId, rebootIfDown: true, maintenanceMode: false },
      select: { id: true },
    });
    if (servers.length === 0) return;

    const cooldownSince = new Date(Date.now() - REBOOT_IF_DOWN_COOLDOWN_MS);
    for (const server of servers) {
      const active = await this.prisma.jobRun.findFirst({
        where: {
          hostId,
          status: { in: ['pending', 'running'] },
          job: { serverInstanceId: server.id, type: { in: REBOOT_IF_DOWN_BLOCKING_JOBS } },
        },
        select: { id: true },
      });
      if (active) continue;

      const recent = await this.prisma.job.findFirst({
        where: {
          serverInstanceId: server.id,
          type: { in: REBOOT_IF_DOWN_BLOCKING_JOBS },
          createdAt: { gte: cooldownSince },
        },
        select: { id: true },
      });
      if (recent) continue;

      await this.jobsService.enqueueInternalJob(orgId, null, server.id, 'SERVER_START', {
        trigger: 'reboot_if_down',
      });
      this.logger.log(`Queued SERVER_START for server ${server.id} (reboot if down)`);
    }
  }

  /**
   * Sweep hosts that have not sent a heartbeat within thresholdMs milliseconds
   * and mark them as offline. Returns the list of hosts that were newly set offline.
   */
  async sweepOfflineHosts(thresholdMs: number): Promise<{ id: string; name: string; orgId: string }[]> {
    const cutoff = new Date(Date.now() - thresholdMs);

    // Find hosts that are currently online (or unknown) but haven't sent a heartbeat recently
    const staleHosts = await this.prisma.host.findMany({
      where: {
        status: { in: ['online', 'unknown'] },
        OR: [
          { lastHeartbeatAt: { lt: cutoff } },
          { lastHeartbeatAt: null },
        ],
      },
      select: { id: true, name: true, orgId: true },
    });

    if (staleHosts.length === 0) return [];

    await this.prisma.host.updateMany({
      where: { id: { in: staleHosts.map((h) => h.id) } },
      data: { status: 'offline' },
    });

    return staleHosts;
  }

  private async pruneHealthSamples(now: number) {
    if (now - this.lastHealthPrune < HEALTH_SAMPLE_PRUNE_INTERVAL_MS) return;
    this.lastHealthPrune = now;
    await this.prisma.healthSample.deleteMany({
      where: { createdAt: { lt: new Date(now - HEALTH_SAMPLE_RETENTION_MS) } },
    });
  }

  private toResponse(
    host: {
      id: string;
      orgId: string;
      name: string;
      lastHeartbeatAt: Date | null;
      agentVersion: string | null;
      agentKeyVersion: number;
      status: string | null;
      lastMetrics: unknown;
      labels: unknown;
      createdAt: Date;
      updatedAt: Date;
      serverInstances?: unknown[];
      _count?: { serverInstances: number };
    },
  ) {
    return {
      id: host.id,
      orgId: host.orgId,
      name: host.name,
      status: host.status ?? 'unknown',
      lastHeartbeatAt: host.lastHeartbeatAt,
      agentVersion: host.agentVersion,
      agentKeyVersion: host.agentKeyVersion,
      lastMetrics: host.lastMetrics ?? null,
      labels: host.labels ?? null,
      serverInstanceCount: host._count?.serverInstances ?? host.serverInstances?.length ?? 0,
      serverInstances: host.serverInstances ?? [],
      createdAt: host.createdAt,
      updatedAt: host.updatedAt,
    };
  }
}
