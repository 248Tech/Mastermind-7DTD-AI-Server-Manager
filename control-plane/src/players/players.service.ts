import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JobsService } from '../jobs/jobs.service';
import { reconcileNameFallback } from './player-identity';

@Injectable()
export class PlayersService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private polling = false;
  constructor(private readonly prisma: PrismaService, private readonly jobs: JobsService) {}
  onModuleInit() {
    const seconds = Math.max(15, Number(process.env.PLAYER_POLL_INTERVAL_SEC || 60));
    this.timer = setInterval(() => void this.pollPlayers(), seconds * 1000);
    setTimeout(() => void this.pollPlayers(), 5000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async pollPlayers() {
    if (this.polling) return;
    this.polling = true;
    try {
      const servers = await this.prisma.serverInstance.findMany({
        where: { gameType: { slug: '7dtd' } }, select: { id: true, orgId: true },
      });
      for (const server of servers) {
        const member = await this.prisma.userOrg.findFirst({ where: { orgId: server.orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
        if (!member) continue;
        const recent = await this.prisma.job.findFirst({ where: { serverInstanceId: server.id, type: 'PLAYER_LIST_SYNC', createdAt: { gte: new Date(Date.now() - 45_000) } } });
        if (!recent) await this.jobs.createJob(server.orgId, member.userId, server.id, 'PLAYER_LIST_SYNC', {});
      }
    } finally { this.polling = false; }
  }
  async list(orgId: string, serverInstanceId?: string) {
    const stablePlayers = await this.prisma.player.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}), NOT: { identityKey: { startsWith: 'name:' } } },
    });
    for (const player of stablePlayers) {
      await reconcileNameFallback(this.prisma, player.serverInstanceId, player.identityKey, player.name, player.steamId, player.eosId);
    }
    const now = Date.now();
    const players = await this.prisma.player.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: [{ online: 'desc' }, { lastSeenAt: 'desc' }],
    });
    return players.map(p => {
      const sessionSeconds = p.online && p.currentSessionStartedAt ? Math.max(0, Math.floor((now - p.currentSessionStartedAt.getTime()) / 1000)) : 0;
      return { ...p, sessionSeconds, lifetimeSeconds: p.lifetimeSeconds + sessionSeconds };
    });
  }
}
