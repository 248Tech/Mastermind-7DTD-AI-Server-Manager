import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { BatchesService } from '../batches/batches.service';
import { JobsQueueService } from './jobs-queue.service';
import type { ReportResultDto } from './dto/report-result.dto';
import { normalizeJobType } from './constants';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchesService: BatchesService,
    private readonly jobsQueueService: JobsQueueService,
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
    const normalizedJobType = normalizeJobType(jobType);

    const serverInstance = await this.prisma.serverInstance.findFirst({
      where: { id: serverInstanceId, orgId },
      include: {
        host: true,
        gameType: { select: { slug: true } },
      },
    });
    if (!serverInstance) {
      throw new NotFoundException('Server instance not found');
    }

    const queuePayload = buildAgentPayload(serverInstance, payload);

    const job = await this.prisma.job.create({
      data: {
        orgId,
        serverInstanceId,
        type: normalizedJobType,
        payload: payload as Prisma.InputJsonValue | undefined,
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
      payload: queuePayload,
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
    };

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: runStatus,
        finishedAt: new Date(),
        result,
      },
    });

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
}

function buildAgentPayload(
  serverInstance: {
    id: string;
    installPath: string | null;
    startCommand: string | null;
    telnetHost: string | null;
    telnetPort: number | null;
    telnetPassword: string | null;
    gameType?: { slug: string };
  },
  payload?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (payload) {
    Object.assign(out, payload);
  }

  out.server_instance_id = serverInstance.id;
  if (serverInstance.gameType?.slug) out.game_type = serverInstance.gameType.slug;
  if (serverInstance.installPath) out.install_path = serverInstance.installPath;
  if (serverInstance.startCommand) out.start_command = serverInstance.startCommand;
  if (serverInstance.telnetHost) out.telnet_host = serverInstance.telnetHost;
  if (serverInstance.telnetPort !== null && serverInstance.telnetPort !== undefined) {
    out.telnet_port = serverInstance.telnetPort;
  }
  if (serverInstance.telnetPassword) out.telnet_password = serverInstance.telnetPassword;

  return out;
}
