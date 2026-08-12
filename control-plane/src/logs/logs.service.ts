import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { reconcileNameFallback } from '../players/player-identity';
import { AlertsService } from '../alerts/alerts.service';

@Injectable()
export class LogsService {
  private readonly lastPrune = new Map<string, number>();
  private readonly scanTails = new Map<string, string>();
  private readonly lineBuffers = new Map<string, string>();
  private readonly chatLineBuffers = new Map<string, string>();
  constructor(private readonly prisma: PrismaService, private readonly alerts: AlertsService) {}

  async append(hostId: string, serverInstanceId: string, content: string) {
    if (!content) return { ok: true };
    if (content.length > 65536) throw new BadRequestException('Log chunk exceeds 64 KiB');
    const server = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, hostId }, select: { id: true, orgId: true, name: true },
    });
    if (!server) throw new NotFoundException('Server instance not found for agent host');
    await this.prisma.serverLog.create({ data: { orgId: server.orgId, serverInstanceId: server.id, content } });
    // Parsers enrich a persisted chunk. One enrichment failure must not reject
    // the upload and force the agent to replay chat or Discord deliveries.
    await this.matchKeywordAlerts(server.orgId, server.id, content).catch(() => undefined);
    await this.parseChat(server.orgId, server.id, server.name, content).catch(() => undefined);
    await this.parsePlayers(server.orgId, server.id, server.name, content).catch(() => undefined);
    await this.retryChatRelays(server.orgId, server.id).catch(() => undefined);
    await this.prune(server.orgId);
    return { ok: true };
  }

  private async parseChat(orgId: string, serverInstanceId: string, serverInstanceName: string, content: string) {
    const combined = (this.chatLineBuffers.get(serverInstanceId) ?? '') + content;
    const lines = combined.split(/\r?\n/);
    this.chatLineBuffers.set(serverInstanceId, lines.pop()?.slice(-4096) ?? '');
    for (const line of lines) {
      const match = line.match(/\bChat \(from '([^']+)', entity id '([^']+)', to '([^']+)'\): '(.*)': (.*)$/);
      if (!match) continue;
      const [, playerId, entityId, channel, rawName, rawMessage] = match;
      if (playerId === '-non-player-' || entityId === '-1') continue;
      const playerName = rawName.trim().slice(0, 128);
      const message = rawMessage.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 2000);
      if (!playerName || !message) continue;
      const logTimestamp = line.match(/^(\S+)/)?.[1] ?? '';
      if (logTimestamp) {
        const duplicate = await this.prisma.event.findFirst({ where: {
          orgId, sourceId: serverInstanceId, eventType: 'player_chat',
          payload: { path: ['logTimestamp'], equals: logTimestamp },
        }, select: { id: true } });
        if (duplicate) continue;
      }
      const event = await this.prisma.event.create({ data: { orgId, sourceType: 'server_instance', sourceId: serverInstanceId, eventType: 'player_chat',
        payload: { playerId, entityId, playerName, channel, message, serverInstanceName, logTimestamp } } });
      const relay = await this.alerts.relayPlayerChat({ eventId: event.id, orgId, serverInstanceId, serverInstanceName, playerName, playerId, channel, message });
      if (relay.configured && !relay.sent) {
        await this.prisma.event.create({ data: { orgId, sourceType: 'server_instance', sourceId: serverInstanceId, eventType: 'player_chat_relay_pending',
          payload: { eventId: event.id, orgId, serverInstanceId, serverInstanceName, playerName, playerId, channel, message, lastError: relay.error } } });
      }
    }
  }

  private async retryChatRelays(orgId: string, serverInstanceId: string) {
    const pending = await this.prisma.event.findMany({
      where: { orgId, sourceId: serverInstanceId, eventType: 'player_chat_relay_pending' },
      orderBy: { createdAt: 'asc' }, take: 10,
    });
    for (const row of pending) {
      const payload = row.payload as Record<string, unknown>;
      const result = await this.alerts.relayPlayerChat({
        eventId: String(payload.eventId ?? row.id), orgId, serverInstanceId,
        serverInstanceName: String(payload.serverInstanceName ?? '7DTD Server'),
        playerName: String(payload.playerName ?? 'Unknown'), playerId: String(payload.playerId ?? 'unknown'),
        channel: String(payload.channel ?? 'Global'), message: String(payload.message ?? ''),
      });
      if (result.sent || !result.configured) await this.prisma.event.delete({ where: { id: row.id } });
    }
  }

  async listChat(orgId: string, serverInstanceId?: string, limit = 200) {
    return this.prisma.event.findMany({ where: { orgId, eventType: 'player_chat', ...(serverInstanceId ? { sourceId: serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit || 200, 1), 500) }).then(rows => rows.reverse());
  }

  async getChatSettings(orgId: string, serverInstanceId: string) {
    const rules = await this.prisma.alertRule.findMany({ where: { orgId }, orderBy: { createdAt: 'asc' } });
    const rule = rules.find(item => { const c=item.condition as Record<string,unknown>; return c?.type==='chat_relay'&&c.serverInstanceId===serverInstanceId; });
    const channel = rule?.channel as Record<string,unknown>|undefined;
    return { enabled: rule?.enabled ?? false, webhookUrl: String(channel?.webhookUrl ?? '') };
  }

  async updateChatSettings(orgId: string, serverInstanceId: string, enabled: boolean, webhookUrl: string) {
    const server = await this.prisma.serverInstance.findFirst({ where: { id: serverInstanceId, orgId }, select: { id: true, name: true } });
    if (!server) throw new NotFoundException('Server instance not found');
    const clean = webhookUrl.trim();
    if (enabled) {
      let parsed: URL; try { parsed=new URL(clean); } catch { throw new BadRequestException('Valid Discord webhook URL required'); }
      if (parsed.protocol!=='https:'||!['discord.com','discordapp.com'].includes(parsed.hostname.toLowerCase())||!parsed.pathname.startsWith('/api/webhooks/')) throw new BadRequestException('Valid Discord webhook URL required');
    }
    const rules = await this.prisma.alertRule.findMany({ where: { orgId } });
    const existing = rules.find(item => { const c=item.condition as Record<string,unknown>; return c?.type==='chat_relay'&&c.serverInstanceId===serverInstanceId; });
    const data = { name: `Chat relay: ${server.name}`, enabled, condition: { type: 'chat_relay', serverInstanceId }, channel: { type: 'discord', webhookUrl: clean } };
    if (existing) await this.prisma.alertRule.update({ where: { id: existing.id }, data });
    else await this.prisma.alertRule.create({ data: { orgId, ...data } });
    return { enabled, webhookUrl: clean };
  }

  private async parsePlayers(orgId: string, serverInstanceId: string, serverInstanceName: string, content: string) {
    const combined = (this.lineBuffers.get(serverInstanceId) ?? '') + content;
    const lines = combined.split(/\r?\n/);
    this.lineBuffers.set(serverInstanceId, lines.pop()?.slice(-4096) ?? '');
    for (const line of lines) {
      // A login produces PlayerLogin, GMSG joined, and PlayerSpawnedInWorld lines.
      // Only the latter two confirm entry, and ignore spawn events caused by teleports.
      const joined = /GMSG: Player '.*' joined the game/i.test(line)
        || /PlayerSpawnedInWorld\s*\(reason:\s*(?:EnterMultiplayer|JoinMultiplayer)\b/i.test(line);
      const left = /PlayerDisconnected|GMSG: Player '.*' left/i.test(line);
      if (!joined && !left) continue;
      const steam = line.match(/(?:PltfmId|OwnerID)\s*=\s*'?Steam_([0-9]{15,20})'?/i)?.[1]
        ?? line.match(/\b(7656119[0-9]{10})\b/)?.[1];
      const eos = line.match(/(?:CrossId|PltfmId)\s*=\s*'?EOS_([a-f0-9]{20,64})'?/i)?.[1];
      const entityText = line.match(/EntityID[=:]\s*([0-9]+)/i)?.[1];
      const name = (line.match(/PlayerName\s*=\s*'?([^',\r\n]+)'?/i)?.[1]
        ?? line.match(/GMSG: Player '([^']+)'/i)?.[1])?.trim();
      const identityKey = steam ? `steam:${steam}` : eos ? `eos:${eos}` : name ? `name:${name.toLowerCase()}` : '';
      if (!identityKey || !name) continue;
      await reconcileNameFallback(this.prisma, serverInstanceId, identityKey, name, steam ?? null, eos ?? null);
      const now = new Date();
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } } });
      if (joined) {
        const player = await this.prisma.player.upsert({
          where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
          create: { orgId, serverInstanceId, identityKey, steamId: steam, eosId: eos, entityId: entityText ? Number(entityText) : null, name, online: true, currentSessionStartedAt: now, lastSeenAt: now },
          update: { steamId: steam ?? existing?.steamId, eosId: eos ?? existing?.eosId, entityId: entityText ? Number(entityText) : existing?.entityId, name, online: true, lastSeenAt: now, ...(!existing?.online ? { currentSessionStartedAt: now } : {}) },
        });
        if (!existing?.online) {
          await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
          await this.alerts.sendMatchingRules('PLAYER_CONNECTED', { orgId, serverInstanceId, serverInstanceName, playerName: name, steamId: steam, eosId: eos }).catch(() => undefined);
        }
      } else if (existing?.online) {
        const started = existing.currentSessionStartedAt;
        const duration = started ? Math.max(0, Math.floor((now.getTime() - started.getTime()) / 1000)) : 0;
        await this.prisma.$transaction([
          this.prisma.player.update({ where: { id: existing.id }, data: { online: false, lastSeenAt: now, currentSessionStartedAt: null, lifetimeSeconds: { increment: duration } } }),
          this.prisma.playerSession.updateMany({ where: { playerId: existing.id, endedAt: null }, data: { endedAt: now, durationSeconds: duration } }),
        ]);
        await this.alerts.sendMatchingRules('PLAYER_DISCONNECTED', { orgId, serverInstanceId, serverInstanceName, playerName: name, steamId: steam ?? existing.steamId ?? undefined, eosId: eos ?? existing.eosId ?? undefined, sessionSeconds: duration }).catch(() => undefined);
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

  async list(orgId: string, serverInstanceId?: string, limit = 250, afterId?: string) {
    const take = Math.min(Math.max(limit || 250, 1), 1000);
    if (afterId) {
      const cursor = await this.prisma.serverLog.findFirst({
        where: { id: afterId, orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
        select: { createdAt: true },
      });
      if (cursor) {
        return this.prisma.serverLog.findMany({
          where: {
            orgId,
            ...(serverInstanceId ? { serverInstanceId } : {}),
            createdAt: { gte: cursor.createdAt },
            NOT: { id: afterId },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take,
          select: { id: true, serverInstanceId: true, content: true, createdAt: true },
        });
      }
    }
    const rows = await this.prisma.serverLog.findMany({
      where: { orgId, ...(serverInstanceId ? { serverInstanceId } : {}) },
      orderBy: { createdAt: 'desc' }, take,
      select: { id: true, serverInstanceId: true, content: true, createdAt: true },
    });
    return rows.reverse();
  }
}
