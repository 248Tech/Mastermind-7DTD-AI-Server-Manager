import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export interface HeartbeatMetrics {
  cpu?: number;
  ramUsedMb?: number;
  diskUsedGb?: number;
  agentVersion?: string;
}

@Injectable()
export class HostsService {
  constructor(private readonly prisma: PrismaService) {}

  /** List all hosts in the org with their server instance count. */
  async findAll(orgId: string) {
    const hosts = await this.prisma.host.findMany({
      where: { orgId },
      include: {
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
      if (metrics.diskUsedGb !== undefined) metricsData.diskUsedGb = metrics.diskUsedGb;
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
      serverInstances: host.serverInstances,
      createdAt: host.createdAt,
      updatedAt: host.updatedAt,
    };
  }
}
