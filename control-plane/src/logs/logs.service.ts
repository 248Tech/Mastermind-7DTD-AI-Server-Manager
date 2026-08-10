import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LogsService {
  private readonly lastPrune = new Map<string, number>();
  private readonly scanTails = new Map<string, string>();
  private readonly lineBuffers = new Map<string, string>();
  constructor(private readonly prisma: PrismaService) {}

  async append(hostId: string, serverInstanceId: string, content: string) {
    if (!content) return { ok: true };
    if (content.length > 65536) throw new BadRequestException('Log chunk exceeds 64 KiB');
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, hostId }, select: { id: true, orgId: true },
    });
    if (!server) throw new NotFoundException('Server instance not found for agent host');
    await this.prisma.serverLog.create({ data: { orgId: server.orgId, serverInstanceId: server.id, content } });
    await this.matchKeywordAlerts(server.orgId, server.id, content);
    await this.parsePlayers(server.orgId, server.id, content);
    await this.prune(server.orgId);
    return { ok: true };
  }

  private async parsePlayers(orgId: string, serverInstanceId: string, content: string) {
    const combined = (this.lineBuffers.get(serverInstanceId) ?? '') + content;
    const lines = combined.split(/\r?\n/);
    this.lineBuffers.set(serverInstanceId, lines.pop()?.slice(-4096) ?? '');
    for (const line of lines) {
      const joined = /PlayerLogin|PlayerSpawnedInWorld|GMSG: Player '.*' joined/i.test(line);
      const left = /PlayerDisconnected|GMSG: Player '.*' left/i.test(line);
      if (!joined && !left) continue;
      const steam = line.match(/(?:PltfmId|OwnerID)\s*=\s*'?Steam_([0-9]{15,20})'?/i)?.[1]
        ?? line.match(/\b(7656119[0-9]{10})\b/)?.[1];
      const eos = line.match(/(?:CrossId|PltfmId)\s*=\s*'?EOS_([a-f0-9]{20,64})'?/i)?.[1];
      const entityText = line.match(/EntityID[=:]\s*([0-9]+)/i)?.[1];
      const name = (line.match(/PlayerName\s*=\s*'?([^',\r\n]+)'?/i)?.[1]
        ?? line.match(/GMSG: Player '([^']+)'/i)?.[1]
        ?? line.match(/PlayerLogin:\s*(?:[^/]+\/)?([^/]+)\//i)?.[1])?.trim();
      const identityKey = steam ? `steam:${steam}` : eos ? `eos:${eos}` : name ? `name:${name.toLowerCase()}` : '';
      if (!identityKey || !name) continue;
      const now = new Date();
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } } });
      if (joined) {
        const player = await this.prisma.player.upsert({
          where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
          create: { orgId, serverInstanceId, identityKey, steamId: steam, eosId: eos, entityId: entityText ? Number(entityText) : null, name, online: true, currentSessionStartedAt: now, lastSeenAt: now },
          update: { steamId: steam ?? existing?.steamId, eosId: eos ?? existing?.eosId, entityId: entityText ? Number(entityText) : existing?.entityId, name, online: true, lastSeenAt: now, ...(!existing?.online ? { currentSessionStartedAt: now } : {}) },
        });
        if (!existing?.online) await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
      } else if (existing) {
        const started = existing.currentSessionStartedAt;
        const duration = started ? Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000)) : 0;
        await this.prisma.$transaction([
          this.prisma.player.update({ where: { id: existing.id }, data: { online: false, lastSeenAt: now, currentSessionStartedAt: null, lifetimeSeconds: { increment: duration } } }),
          this.prisma.playerSession.updateMany({ where: { playerId: existing.id, endedAt: null }, data: { endedAt: now, durationSeconds: duration } }),
        ]);
      }
    }
  }

  async listKeywordRules(orgId: string) {
    const rules = await this.prisma.alertRule.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' } });
    return rules.filter(r => (r.condition as Record<string, unknown>)?.type === 'log_keyword').map(r => ({
      id: r.id, name: r.name, enabled: r.enabled, condition: r.condition, createdAt: r.createdAt,
    }));
  }

  async createKeywordRule(orgId: string, serverInstanceId: string, keyword: string, caseSensitive = false) {
    const clean = keyword.trim();
    if (!clean || clean.length > 200) throw new BadRequestException('Keyword must contain 1-200 characters');
    const server = await this.prisma.serverInstance.findFirst({ where: { id: serverInstanceId, orgId }, select: { id: true } });
    if (!server) throw new NotFoundException('Server instance not found');
    return this.prisma.alertRule.create({ data: {
      orgId, name: `Log: ${clean}`, enabled: true,
      condition: { type: 'log_keyword', serverInstanceId, keyword: clean, caseSensitive },
      channel: { type: 'dashboard' },
    }});
  }

  async setKeywordRuleEnabled(orgId: string, id: string, enabled: boolean) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id, orgId } });
    if (!rule || (rule.condition as Record<string, unknown>)?.type !== 'log_keyword') throw new NotFoundException('Keyword rule not found');
    return this.prisma.alertRule.update({ where: { id }, data: { enabled } });
  }

  async deleteKeywordRule(orgId: string, id: string) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id, orgId } });
    if (!rule || (rule.condition as Record<string, unknown>)?.type !== 'log_keyword') throw new NotFoundException('Keyword rule not found');
    await this.prisma.alertRule.delete({ where: { id } });
  }

  async listKeywordMatches(orgId: string, serverInstanceId?: string, limit = 50) {
    const rows = await this.prisma.event.findMany({
      where: { orgId, eventType: 'log_keyword_match', ...(serverInstanceId ? { sourceId: serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
    });
    return rows;
  }

  private async matchKeywordAlerts(orgId: string, serverInstanceId: string, content: string) {
    const prior = this.scanTails.get(serverInstanceId) ?? '';
    const searchable = prior + content;
    this.scanTails.set(serverInstanceId, searchable.slice(-256));
    const rules = await this.prisma.alertRule.findMany({ where: { orgId, enabled: true } });
    for (const rule of rules) {
      const condition = rule.condition as Record<string, unknown>;
      if (condition?.type !== 'log_keyword' || condition.serverInstanceId !== serverInstanceId) continue;
      const keyword = String(condition.keyword ?? '');
      if (!keyword) continue;
      const haystack = condition.caseSensitive ? searchable : searchable.toLowerCase();
      const needle = condition.caseSensitive ? keyword : keyword.toLowerCase();
      const index = haystack.lastIndexOf(needle);
      if (index < 0 || index + needle.length <= prior.length) continue;
      const start = Math.max(0, index - 180);
      const end = Math.min(searchable.length, index + needle.length + 180);
      await this.prisma.event.create({ data: {
        orgId, sourceType: 'server_instance', sourceId: serverInstanceId,
        eventType: 'log_keyword_match',
        payload: { ruleId: rule.id, ruleName: rule.name, keyword, excerpt: searchable.slice(start, end) },
      }});
    }
  }

  async getSettings(orgId: string) {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { logRetentionDays: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateSettings(orgId: string, logRetentionDays: number) {
    if (![1, 7, 30].includes(logRetentionDays)) {
      throw new BadRequestException('Retention must be 1, 7, or 30 days');
    }
    const settings = await this.prisma.org.update({
      where: { id: orgId }, data: { logRetentionDays }, select: { logRetentionDays: true },
    });
    this.lastPrune.delete(orgId);
    await this.prune(orgId);
    return settings;
  }

  private async prune(orgId: string) {
    const now = Date.now();
    if (now - (this.lastPrune.get(orgId) ?? 0) < 60_000) return;
    this.lastPrune.set(orgId, now);
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { logRetentionDays: true } });
    if (!org) return;
    await this.prisma.serverLog.deleteMany({
      where: { orgId, createdAt: { lt: new Date(now - org.logRetentionDays * 86_400_000) } },
    });
  }

  async list(orgId: string, serverInstanceId?: string, limit = 250) {
    const take = Math.min(Math.max(limit || 250, 1), 1000);
    const rows = await this.prisma.serverLog.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take,
      select: { id: true, serverInstanceId: true, content: true, createdAt: true },
    });
    return rows.reverse();
  }
}
