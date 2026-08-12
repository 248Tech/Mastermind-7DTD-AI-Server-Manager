import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BatchesService } from '../batches/batches.service';
import { JobsQueueService } from './jobs-queue.service';
import type { ReportResultDto } from './dto/report-result.dto';
import { reconcileNameFallback } from '../players/player-identity';
import { AlertsService } from '../alerts/alerts.service';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchesService: BatchesService,
    private readonly jobsQueueService: JobsQueueService,
    private readonly alerts: AlertsService,
  ) {}

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
    if (run.job.type === 'PROFILE_STAGE') {
      const previous = (run.job.payload ?? {}) as Record<string, unknown>;
      await this.prisma.job.update({ where: { id: run.jobId }, data: { payload: { path: previous.path, staged: runStatus === 'success' } as Prisma.InputJsonValue } });
    }

    if (run.job.type === 'PLAYER_LIST_SYNC' && runStatus === 'success' && dto.output && run.job.serverInstanceId) {
      await this.reconcilePlayers(run.job.orgId, run.job.serverInstanceId, dto.output);
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

  private async reconcilePlayers(orgId: string, serverInstanceId: string, output: string) {
    if (!/Total of\s+\d+\s+in the game/i.test(output)) return;
    const now = new Date();
    const server = await this.prisma.serverInstance.findUnique({
      where: { id: serverInstanceId }, select: { name: true },
    });
    const seen = new Set<string>();
    for (const line of output.split(/\r?\n/)) {
      const head = line.match(/^\s*\d+\.\s+id=(\d+),\s*([^,]+),/i);
      if (!head) continue;
      const steam = line.match(/(?:pltfmid|steamid)=Steam_([0-9]{15,20})/i)?.[1] ?? null;
      const eos = line.match(/(?:crossid|pltfmid)=EOS_([a-f0-9]{20,64})/i)?.[1] ?? null;
      const name = head[2].trim();
      const identityKey = steam ? `steam:${steam}` : eos ? `eos:${eos}` : `name:${name.toLowerCase()}`;
      seen.add(identityKey);
      await reconcileNameFallback(this.prisma, serverInstanceId, identityKey, name, steam, eos);
      const existing = await this.prisma.player.findUnique({ where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } } });
      const player = await this.prisma.player.upsert({
        where: { serverInstanceId_identityKey: { serverInstanceId, identityKey } },
        create: { orgId, serverInstanceId, identityKey, steamId: steam, eosId: eos, entityId: Number(head[1]), name, online: true, currentSessionStartedAt: now, lastSeenAt: now },
        update: { steamId: steam ?? existing?.steamId, eosId: eos ?? existing?.eosId, entityId: Number(head[1]), name, online: true, lastSeenAt: now, ...(!existing?.online ? { currentSessionStartedAt: now } : {}) },
      });
      if (!existing?.online) await this.prisma.playerSession.create({ data: { playerId: player.id, startedAt: now } });
    }
    const missing = await this.prisma.player.findMany({ where: { serverInstanceId, online: true, identityKey: { notIn: [...seen] } } });
    for (const player of missing) {
      const end = player.lastSeenAt < now ? player.lastSeenAt : now;
      const duration = player.currentSessionStartedAt ? Math.max(0, Math.floor((end.getTime() - player.currentSessionStartedAt.getTime()) / 1000)) : 0;
      await this.prisma.$transaction([
        this.prisma.player.update({ where: { id: player.id }, data: { online: false, currentSessionStartedAt: null, lifetimeSeconds: { increment: duration } } }),
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
  }
}
