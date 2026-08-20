import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BatchesService } from '../batches/batches.service';
import { JobsQueueService } from './jobs-queue.service';
import type { ReportResultDto } from './dto/report-result.dto';
import { reconcileNameFallback } from '../players/player-identity';
import { AlertsService } from '../alerts/alerts.service';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { pruneMap } from '../common/ttl-map';
import { parseInventoryOutput, type AllocsInventoryRow, type InventorySnapshot } from '../players/player-inventory';
import { parseAllocsPlayersOnline, parseLpRoster, type PlayerRosterRow } from '../players/player-roster';
import { AllocsService } from '../allocs/allocs.service';
import {
  MAX_GRANT_ATTEMPTS,
  buildChatColorCommand,
  buildGivePlusCommand,
  classifyGrantOutput,
} from '../donations/shop-grants';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly badPingSamples = new Map<string, number>();
  private readonly protectionCooldown = new Map<string, number>();
  private readonly countryCache = new Map<string, { code: string; expires: number }>();
  private readonly inventoryCooldown = new Map<string, number>();
  private staleTimer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchesService: BatchesService,
    private readonly jobsQueueService: JobsQueueService,
    private readonly alerts: AlertsService,
    private readonly allocs: AllocsService,
  ) {}

  async onModuleInit() {
    await this.failStaleRunningJobs();
    this.staleTimer = setInterval(() => void this.failStaleRunningJobs(), 60_000);
  }

  onModuleDestroy() { if (this.staleTimer) clearInterval(this.staleTimer); }

  private async failStaleRunningJobs() {
    const cutoff = Date.now() - 3 * 60_000;
    const runs = await this.prisma.jobRun.findMany({ where: { status: 'running' }, select: { id: true, result: true, startedAt: true } });
    for (const run of runs) {
      const result = (run.result ?? {}) as Record<string, unknown>;
      const heartbeat = Date.parse(String(result.updatedAt ?? '')) || run.startedAt?.getTime() || 0;
      if (heartbeat >= cutoff) continue;
      await this.prisma.jobRun.updateMany({ where: { id: run.id, status: 'running' }, data: {
        status: 'failed', finishedAt: new Date(), result: { ...result, errorMessage: 'Agent stopped reporting progress; job released as stale. Retry if still needed.', recoveredAt: new Date().toISOString() },
      }});
    }
  }

  /**
   * Create a single job + job run and enqueue it for the target host.
   */
  async createJob(
    orgId: string,
    userId: string,
    serverInstanceId: string,
    jobType: string,
    payload?: Record<string, unknown>,
  ): Promise<{ jobId: string; jobRunId: string }> {
    const normalizedJobType = this.normalizeJobType(jobType);
    if (normalizedJobType === 'RCON' || normalizedJobType === 'SEND_COMMAND') {
      const command = typeof payload?.command === 'string' ? payload.command.trim() : '';
      if (!command) throw new BadRequestException('Console command is required');
      if (command.length > 512) throw new BadRequestException('Console command cannot exceed 512 characters');
      if (/[\r\n]/.test(command)) throw new BadRequestException('Only one console command may be sent at a time');
      payload = { ...(payload ?? {}), command };
    }
    if (normalizedJobType === 'PLAYER_ADMIN_PROMOTE' || normalizedJobType === 'PLAYER_ADMIN_DEMOTE') {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (membership?.role.name !== 'admin') {
        throw new ForbiddenException('Only organization administrators may change game administrators');
      }
    }
    if (normalizedJobType === 'PLAYER_KICK_ALL' || normalizedJobType === 'SERVER_KILL') {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) {
        throw new ForbiddenException('Only organization administrators or operators may perform this action');
      }
    }
    if (['SAVE_BACKUP', 'SAVE_RESTORE', 'SAVE_DELETE', 'SAVE_RETENTION'].includes(normalizedJobType)) {
      const membership = await this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId } },
        include: { role: true },
      });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) {
        throw new ForbiddenException('Only organization administrators or operators may manage saves');
      }
    }
    if (normalizedJobType === 'PROFILE_STAGE') {
      const membership = await this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId, orgId } }, include: { role: true } });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) throw new ForbiddenException('Only organization administrators or operators may stage player profiles');
    }
    if (normalizedJobType === 'MOD_UPLOAD_QUARANTINE') {
      const membership = await this.prisma.userOrg.findUnique({ where: { userId_orgId: { userId, orgId } }, include: { role: true } });
      if (!membership || !['admin', 'operator'].includes(membership.role.name)) throw new ForbiddenException('Only organization administrators or operators may upload mods');
    }
    const serverInstance = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      include: {
        host: true,
        gameType: { select: { slug: true } },
        org: { select: { avoidBloodMoonRestart: true } },
      },
    });
    if (!serverInstance) {
      throw new NotFoundException('Server instance not found');
    }

    const mergedPayload = {
      server_instance_id: serverInstance.id,
      game_type: serverInstance.gameType.slug,
      install_path: serverInstance.installPath ?? undefined,
      start_command: serverInstance.startCommand ?? undefined,
      telnet_host: serverInstance.telnetHost ?? undefined,
      telnet_port: serverInstance.telnetPort ?? undefined,
      telnet_password: serverInstance.telnetPassword ?? undefined,
      config: serverInstance.config ?? undefined,
      avoid_blood_moon_restart: serverInstance.org.avoidBloodMoonRestart,
      ...(payload ?? {}),
    };

    const job = await this.prisma.job.create({
      data: {
        orgId,
        serverInstanceId,
        type: normalizedJobType,
        payload: mergedPayload as Prisma.InputJsonValue,
        createdById: userId,
      },
    });

    const run = await this.prisma.jobRun.create({
      data: {
        jobId: job.id,
        hostId: serverInstance.hostId,
        status: 'pending',
      },
    });

    await this.jobsQueueService.addJob(orgId, {
      jobId: job.id,
      jobRunId: run.id,
      hostId: serverInstance.hostId,
      serverInstanceId,
      type: normalizedJobType,
      payload: mergedPayload,
    });

    return { jobId: job.id, jobRunId: run.id };
  }

  /**
   * Update JobRun with agent result and optionally update batch progress.
   */
  async reportJobResult(
    hostId: string,
    jobRunId: string,
    dto: ReportResultDto,
  ): Promise<{ ok: boolean }> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run) throw new NotFoundException('Job run not found');
    if (run.hostId !== hostId) {
      throw new BadRequestException('Job run does not belong to this host');
    }
    if (run.status !== 'running') {
      throw new BadRequestException(`Job run is not running (status: ${run.status})`);
    }

    const runStatus = dto.status === 'success' ? 'success' : 'failed';
    const result = {
      durationMs: dto.durationMs,
      errorMessage: dto.errorMessage,
      output: dto.output,
      data: dto.result as Prisma.InputJsonValue | undefined,
    };

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: runStatus,
        finishedAt: new Date(),
        result,
      },
    });
    if (run.job.type === 'MOD_UPLOAD_QUARANTINE') {
      const payload = (run.job.payload ?? {}) as Record<string, unknown>;
      const uploadId = typeof payload.uploadId === 'string' ? payload.uploadId : '';
      if (/^[0-9a-f-]{36}$/i.test(uploadId)) {
        await unlink(join(process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads', `${uploadId}.zip`)).catch(() => undefined);
      }
    }
    if (run.job.type === 'PROFILE_STAGE') {
      const previous = (run.job.payload ?? {}) as Record<string, unknown>;
      await this.prisma.job.update({ where: { id: run.jobId }, data: { payload: { path: previous.path, staged: runStatus === 'success' } as Prisma.InputJsonValue } });
    }

    if (run.job.type === 'PLAYER_LIST_SYNC' && runStatus === 'success' && dto.output && run.job.serverInstanceId) {
      const rows = parseLpRoster(dto.output);
      if (rows) {
        await this.applyPlayerRoster(run.job.orgId, run.job.serverInstanceId, rows);
        await this.enforceConnectionTools(run.job.orgId, run.job.serverInstanceId, rows);
      }
    }
    const resultPayload = (run.job.payload ?? {}) as Record<string, unknown>;
    if (run.job.type === 'RCON' && resultPayload.purpose === 'inventory_snapshot' && typeof resultPayload.playerId === 'string' && runStatus === 'success' && dto.output) {
      await this.storeInventorySnapshot(resultPayload.playerId, dto.output);
    }
    if (run.job.type === 'RCON' && resultPayload.purpose === 'shop_grant' && typeof resultPayload.donationLineId === 'string') {
      await this.finishShopGrant(resultPayload, runStatus, dto.output);
    }

    const orgId = run.job.orgId;
    if (run.job.batchId) {
      await this.batchesService.recordJobRunCompleted(orgId, run.jobId, runStatus, 'running');
    }

    return { ok: true };
  }

  /**
   * Mark job run as running when agent picks it. Call from get-next-job flow.
   */
  async markJobRunStarted(hostId: string, jobRunId: string): Promise<void> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run || run.hostId !== hostId) return;
    if (run.status !== 'pending') return;

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: { status: 'running', startedAt: new Date() },
    });

    if (run.job.batchId) {
      await this.batchesService.recordJobRunStarted(run.job.orgId, run.jobId);
    }
  }

  private normalizeJobType(jobType: string): string {
    switch (jobType.toLowerCase()) {
      case 'start':
        return 'SERVER_START';
      case 'stop':
        return 'SERVER_STOP';
      case 'restart':
        return 'SERVER_RESTART';
      case 'rcon':
        return 'RCON';
      default:
        return jobType.toUpperCase();
    }
  }

  async reportJobProgress(
    hostId: string,
    jobRunId: string,
    phase: string,
    message?: string,
  ): Promise<{ ok: boolean }> {
    const run = await this.prisma.jobRun.findUnique({ where: { id: jobRunId } });
    if (!run) throw new NotFoundException('Job run not found');
    if (run.hostId !== hostId) throw new BadRequestException('Job run does not belong to this host');
    if (run.status !== 'running') throw new BadRequestException(`Job run is not running (status: ${run.status})`);
    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: { result: { phase, ...(message ? { message } : {}), updatedAt: new Date().toISOString() } },
    });
    return { ok: true };
  }

  async trySyncPlayersFromAllocs(orgId: string, serverInstanceId: string): Promise<boolean> {
    if (!this.allocs.tokenConfigured()) return false;
    let rows: PlayerRosterRow[] | null = null;
    try {
      const json = await this.allocs.playersOnlineJson();
      rows = parseAllocsPlayersOnline(json);
    } catch {
      return false;
    }
    if (!rows) return false;
    await this.applyPlayerRoster(orgId, serverInstanceId, rows);
    await this.enforceConnectionTools(orgId, serverInstanceId, rows);
    return true;
  }

  private async applyPlayerRoster(orgId: string, serverInstanceId: string, rows: PlayerRosterRow[]) {
    const now = new Date();
    const server = await this.prisma.serverInstance.findUnique({
      where: { id: serverInstanceId }, select: { name: true },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.identityKey);
      await reconcileNameFallback(this.prisma, serverInstanceId, row.identityKey, row.name, row.steamId, row.eosId);
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey: row.identityKey } } });
      const player = await this.prisma.player.upsert({
        where: { serverInstanceId_identityKey: { serverInstanceId, identityKey: row.identityKey } },
        create: {
          orgId,
          serverInstanceId,
          identityKey: row.identityKey,
          steamId: row.steamId,
          eosId: row.eosId,
          entityId: row.entityId,
          ipAddress: row.ipAddress,
          name: row.name,
          online: true,
          currentSessionStartedAt: now,
          lastSeenAt: now,
          zombieKills: row.zombieKills,
          playerKills: row.playerKills,
          deaths: row.deaths,
          level: row.level,
          ...(row.position ? { lastPosX: row.position.x, lastPosY: row.position.y, lastPosZ: row.position.z } : {}),
        },
        update: {
          steamId: row.steamId ?? existing?.steamId,
          eosId: row.eosId ?? existing?.eosId,
          entityId: row.entityId,
          ...(row.ipAddress ? { ipAddress: row.ipAddress } : {}),
          name: row.name,
          online: true,
          lastSeenAt: now,
          zombieKills: row.zombieKills,
          playerKills: row.playerKills,
          deaths: row.deaths,
          level: row.level,
          ...(row.position ? { lastPosX: row.position.x, lastPosY: row.position.y, lastPosZ: row.position.z } : {}),
          ...(!existing?.online ? { currentSessionStartedAt: now } : {}),
        },
      });
      if (!existing?.online) await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
    }
    const missing = await this.prisma.player.findMany({ where: { serverInstanceId, online: true, identityKey: { notIn: [...seen] } } });
    for (const player of missing) {
      const end = player.lastSeenAt < now ? player.lastSeenAt : now;
      const duration = player.currentSessionStartedAt ? Math.max(0, Math.floor((end.getTime() - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
      await this.prisma.$transaction([
        this.prisma.player.update({ where: { id: player.id }, data: { online: false, currentSessionStartedAt: null, lastLogoutAt: end, lifetimeSeconds: { increment: duration } } }),
        this.prisma.playerSession.updateMany({ where: { playerId: player.id, endedAt: null }, data: { endedAt: end, durationSeconds: duration } }),
      ]);
      await this.alerts.sendMatchingRules('PLAYER_DISCONNECTED', {
        orgId,
        serverInstanceId,
        serverInstanceName: server?.name ?? '7DTD Server',
        playerName: player.name,
        steamId: player.steamId ?? undefined,
        eosId: player.eosId ?? undefined,
        sessionSeconds: duration,
      }).catch(() => undefined);
    }
    await this.queueInventorySnapshots(orgId, serverInstanceId).catch(() => undefined);
    await this.enqueuePendingShopGrants(orgId, serverInstanceId).catch(() => undefined);
  }

  private async storeInventorySnapshot(playerId: string, output: string) {
    await this.persistInventorySnapshot(playerId, parseInventoryOutput(output));
  }

  private async persistInventorySnapshot(playerId: string, snapshot: InventorySnapshot) {
    const itemCount = snapshot.bag.length + snapshot.belt.length + snapshot.equipment.length;
    // Do not replace a real snapshot with an empty one when a game build or
    // missing mod rejects the inventory command. The agent classifies command
    // errors as failed; this guard also protects against malformed responses.
    if (!itemCount) return;
    await this.prisma.player.updateMany({
      where: { id: playerId },
      data: {
        lastInventory: snapshot,
        lastInventoryAt: new Date(),
      },
    });
  }

  private async queueInventorySnapshots(_orgId: string, serverInstanceId: string) {
    const now = Date.now();
    pruneMap(this.inventoryCooldown, (until) => until > now);
    if (!this.allocs.tokenConfigured()) return;
    const due = await this.staleOnlinePlayers(serverInstanceId, now);
    if (!due.length) return;
    const batch = await this.allocs.inventorySnapshots();
    if (batch) {
      for (const player of due) {
        const row = batch.find((entry) => this.inventoryRowMatches(entry, player));
        if (!row) continue;
        await this.persistInventorySnapshot(player.id, row.snapshot);
      }
      return;
    }
    await this.queueInventorySnapshotsFallback(due, now);
  }

  private staleOnlinePlayers(serverInstanceId: string, now: number) {
    return this.prisma.player.findMany({
      where: {
        serverInstanceId,
        online: true,
        AND: [
          { OR: [{ steamId: { not: null } }, { eosId: { not: null } }] },
          { OR: [{ lastInventoryAt: null }, { lastInventoryAt: { lt: new Date(now - 5 * 60_000) } }] },
        ],
      },
      select: { id: true, steamId: true, eosId: true },
      take: 32,
    });
  }

  private inventoryRowMatches(
    row: AllocsInventoryRow,
    player: { steamId: string | null; eosId: string | null },
  ) {
    if (row.steamId && player.steamId && row.steamId === player.steamId) return true;
    if (row.eosId && player.eosId && row.eosId.toLowerCase() === player.eosId.toLowerCase()) return true;
    return false;
  }

  private async queueInventorySnapshotsFallback(
    due: Array<{ id: string; steamId: string | null; eosId: string | null }>,
    now: number,
  ) {
    let queued = 0;
    for (const player of due) {
      if (queued >= 2) break;
      if ((this.inventoryCooldown.get(player.id) ?? 0) > now) continue;
      this.inventoryCooldown.set(player.id, now + 2 * 60_000);
      const snapshot = await this.allocs.inventorySnapshot(player.steamId, player.eosId);
      if (snapshot) await this.persistInventorySnapshot(player.id, snapshot);
      queued++;
    }
  }

  async enqueueShopGrants(orgId: string, serverInstanceId: string, playerId: string, steamId: string) {
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, orgId, serverInstanceId },
      select: { id: true, online: true },
    });
    if (!player) return;
    await this.deliverShopGrantLines(orgId, serverInstanceId, player.id, steamId, player.online, 8);
  }

  private async enqueuePendingShopGrants(orgId: string, serverInstanceId: string) {
    const online = await this.prisma.player.findMany({
      where: { orgId, serverInstanceId, online: true, steamId: { not: null } },
      select: { id: true, steamId: true },
      take: 32,
    });
    for (const player of online) {
      if (!player.steamId) continue;
      await this.deliverShopGrantLines(orgId, serverInstanceId, player.id, player.steamId, true, 2);
    }
    const colorLines = await this.prisma.donationLine.findMany({
      where: {
        chatColorStatus: { in: ['pending', 'queued'] },
        grantAttempts: { lt: MAX_GRANT_ATTEMPTS },
        donation: { orgId, serverInstanceId, status: 'completed' },
      },
      include: { donation: { select: { playerId: true, steamId: true } } },
      take: 8,
    });
    for (const line of colorLines) {
      await this.deliverShopGrantLines(orgId, serverInstanceId, line.donation.playerId, line.donation.steamId, false, 1);
    }
  }

  private async deliverShopGrantLines(
    orgId: string,
    serverInstanceId: string,
    playerId: string,
    steamId: string,
    online: boolean,
    limit: number,
  ) {
    const member = await this.prisma.userOrg.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    if (!member) return;
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const lines = await this.prisma.donationLine.findMany({
      where: {
        grantAttempts: { lt: MAX_GRANT_ATTEMPTS },
        donation: { playerId, orgId, serverInstanceId, status: 'completed' },
        OR: [
          { grantStatus: { in: ['pending', 'queued'] } },
          { chatColorStatus: { in: ['pending', 'queued'] } },
        ],
      },
      take: 16,
    });
    let queued = 0;
    for (const line of lines) {
      if (queued >= limit) break;
      const stale = !line.grantQueuedAt || line.grantQueuedAt < staleBefore;
      const colorDue = line.chatColorStatus === 'pending' || (line.chatColorStatus === 'queued' && stale);
      const itemDue = online && (line.grantStatus === 'pending' || (line.grantStatus === 'queued' && stale));
      if (colorDue && line.chatColor) {
        const command = buildChatColorCommand(steamId, line.chatColor);
        if (command && await this.queueShopGrantJob(orgId, member.userId, serverInstanceId, line.id, 'chat_color', command, { chatColorStatus: 'queued' })) {
          queued += 1;
        }
      }
      if (itemDue && line.grantItemName) {
        const command = buildGivePlusCommand(steamId, line.grantItemName, line.grantQuantity, line.grantQuality);
        if (command && await this.queueShopGrantJob(orgId, member.userId, serverInstanceId, line.id, 'item', command, { grantStatus: 'queued' })) {
          queued += 1;
        }
      }
    }
  }

  private async queueShopGrantJob(
    orgId: string,
    userId: string,
    serverInstanceId: string,
    donationLineId: string,
    grantKind: 'item' | 'chat_color',
    command: string,
    status: { grantStatus?: string; chatColorStatus?: string },
  ) {
    try {
      await this.prisma.donationLine.update({
        where: { id: donationLineId },
        data: { ...status, grantQueuedAt: new Date(), grantAttempts: { increment: 1 }, grantError: null },
      });
      await this.createJob(orgId, userId, serverInstanceId, 'RCON', {
        command,
        purpose: 'shop_grant',
        donationLineId,
        grantKind,
      });
      return true;
    } catch {
      await this.prisma.donationLine.update({
        where: { id: donationLineId },
        data: grantKind === 'item' ? { grantStatus: 'pending' } : { chatColorStatus: 'pending' },
      }).catch(() => undefined);
      return false;
    }
  }

  private async finishShopGrant(payload: Record<string, unknown>, runStatus: string, output?: string) {
    const lineId = String(payload.donationLineId || '');
    if (!lineId) return;
    const outcome = classifyGrantOutput(output, runStatus);
    const next = outcome === 'delivered' ? 'delivered' : outcome === 'failed' ? 'failed' : 'pending';
    const error = next === 'delivered' ? null : String(output || 'Grant command failed').slice(0, 180);
    await this.prisma.donationLine.updateMany({
      where: { id: lineId },
      data: payload.grantKind === 'chat_color'
        ? { chatColorStatus: next, grantError: error, grantedAt: next === 'delivered' ? new Date() : undefined }
        : { grantStatus: next, grantError: error, grantedAt: next === 'delivered' ? new Date() : undefined },
    });
  }

  private async enforceConnectionTools(orgId:string,serverInstanceId:string,rows:PlayerRosterRow[]){
    const settings=await this.prisma.serverProtectionSettings.findUnique({where:{serverInstanceId}});
    if(!settings||(!settings.highPingEnabled&&!settings.countryBanEnabled))return;
    const member=await this.prisma.userOrg.findFirst({where:{orgId},orderBy:{createdAt:'asc'},select:{userId:true}});
    if(!member)return;
    for(const row of rows){
      const identifier=row.steamId||row.eosId||String(row.entityId);const key=`${serverInstanceId}:${identifier}`;
      if((this.protectionCooldown.get(key)||0)>Date.now())continue;
      if(settings.highPingEnabled&&row.ping!=null){
        const count=row.ping>settings.highPingThresholdMs?(this.badPingSamples.get(key)||0)+1:0;this.badPingSamples.set(key,count);
        if(count>=settings.highPingSamples){
          await this.createJob(orgId,member.userId,serverInstanceId,'PLAYER_KICK',{identifier,reason:`${settings.highPingReason} (${row.ping} ms)`});
          this.badPingSamples.set(key,0);this.protectionCooldown.set(key,Date.now()+5*60_000);continue;
        }
      }
      if(settings.countryBanEnabled){
        const ip=row.ipAddress;
        if(!ip||this.isPrivateAddress(ip))continue;
        const code=await this.countryForIp(ip);const blocked=Array.isArray(settings.blockedCountryCodes)?settings.blockedCountryCodes.map(String):[];
        if(code&&blocked.includes(code)){
          const type=settings.countryAction==='ban'?'PLAYER_BAN':'PLAYER_KICK';
          await this.createJob(orgId,member.userId,serverInstanceId,type,{identifier,reason:`${settings.countryReason} (${code})`,...(type==='PLAYER_BAN'?{duration:settings.countryBanDuration}:{})});
          this.protectionCooldown.set(key,Date.now()+24*60*60_000);
        }
      }
    }
  }
  private isPrivateAddress(ip:string){return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd)/i.test(ip);}
  private pruneProtectionState(now:number){
    pruneMap(this.protectionCooldown,(until)=>until>now);
    pruneMap(this.countryCache,(entry)=>entry.expires>now);
    if(this.badPingSamples.size>2_000)this.badPingSamples.clear();
  }
  private async countryForIp(ip:string){
    this.pruneProtectionState(Date.now());
    const cached=this.countryCache.get(ip);if(cached&&cached.expires>Date.now())return cached.code;
    try{const response=await fetch(`https://api.country.is/${encodeURIComponent(ip)}`,{signal:AbortSignal.timeout(3000)});if(!response.ok)return'';const data=await response.json() as {country?:string};const code=String(data.country||'').toUpperCase();if(/^[A-Z]{2}$/.test(code)){this.countryCache.set(ip,{code,expires:Date.now()+24*60*60_000});return code;}}catch{return'';}return'';
  }
}
