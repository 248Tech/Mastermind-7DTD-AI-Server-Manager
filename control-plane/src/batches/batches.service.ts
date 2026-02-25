import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleDestroy,
  Optional,
  Inject,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { BATCH_PROGRESS } from '../websocket/events';
import type { CreateBatchDto } from './dto/create-batch.dto';
import type { BatchSummaryDto, BatchJobDto } from './dto/batch-response.dto';
import { JOB_ATTEMPTS } from '../jobs/constants';

export const BATCH_PROGRESS_EMITTER = Symbol('BATCH_PROGRESS_EMITTER');

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

const BATCH_TYPE_TO_JOB_TYPE: Record<string, string> = {
  restart_wave: 'SERVER_RESTART',
  update_wave: 'SERVER_UPDATE',
  bulk_mod_install: 'BULK_MOD_INSTALL',
  custom: 'custom',
};

/** Optional: inject a gateway that can emit to org room. No-op if not provided. */
export interface IBatchProgressEmitter {
  emitToOrg(orgId: string, event: string, payload: unknown): void;
}

@Injectable()
export class BatchesService implements OnModuleDestroy {
  private orgQueues = new Map<string, Queue>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BATCH_PROGRESS_EMITTER) private readonly progressEmitter?: IBatchProgressEmitter,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const q of this.orgQueues.values()) await q.close();
    this.orgQueues.clear();
  }

  private getOrgQueue(orgId: string): Queue {
    if (!this.orgQueues.has(orgId)) {
      this.orgQueues.set(
        orgId,
        new Queue(`jobs:${orgId}`, { connection: REDIS_CONNECTION }),
      );
    }
    return this.orgQueues.get(orgId)!;
  }

  async createBatch(
    orgId: string,
    userId: string | null,
    dto: CreateBatchDto,
  ): Promise<BatchSummaryDto> {
    const instances = await this.prisma.serverInstance.findMany({
      where: { id: { in: dto.serverInstanceIds }, orgId },
      include: { host: true },
    });
    if (instances.length !== dto.serverInstanceIds.length) {
      const found = new Set(instances.map((i) => i.id));
      const missing = dto.serverInstanceIds.filter((id) => !found.has(id));
      throw new BadRequestException(
        `Server instance(s) not found or not in org: ${missing.join(', ')}`,
      );
    }

    const jobType = BATCH_TYPE_TO_JOB_TYPE[dto.type] ?? dto.type;

    const batch = await this.prisma.jobBatch.create({
      data: {
        orgId,
        type: dto.type,
        status: 'running',
        totalCount: instances.length,
        pendingCount: instances.length,
        runningCount: 0,
        successCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        createdById: userId,
      },
    });

    const queue = this.getOrgQueue(orgId);
    const backoff = 2000;

    for (const si of instances) {
      const job = await this.prisma.job.create({
        data: {
          orgId,
          batchId: batch.id,
          serverInstanceId: si.id,
          type: jobType,
          payload: dto.payload ?? undefined,
          createdById: userId,
        },
      });
      const run = await this.prisma.jobRun.create({
        data: { jobId: job.id, hostId: si.hostId, status: 'pending' },
      });

      await queue.add(
        {
          jobId: job.id,
          jobRunId: run.id,
          hostId: si.hostId,
          serverInstanceId: si.id,
          type: jobType,
          payload: dto.payload ?? {},
        },
        {
          jobId: run.id,
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'fixed' as const, delay: backoff },
        },
      );

      await this.auditJob(orgId, userId, 'job_created', job.id, {
        batchId: batch.id,
        serverInstanceId: si.id,
      });
    }

    await this.audit(orgId, userId, 'batch_created', batch.id, {
      type: batch.type,
      serverCount: batch.totalCount,
    });

    return this.toSummary(batch);
  }

  async listBatches(orgId: string, limit = 50): Promise<BatchSummaryDto[]> {
    const list = await this.prisma.jobBatch.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return list.map((b) => this.toSummary(b));
  }

  async getBatch(orgId: string, batchId: string): Promise<BatchSummaryDto> {
    const batch = await this.prisma.jobBatch.findFirst({
      where: { id: batchId, orgId },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return this.toSummary(batch);
  }

  async getBatchJobs(orgId: string, batchId: string): Promise<BatchJobDto[]> {
    const batch = await this.prisma.jobBatch.findFirst({
      where: { id: batchId, orgId },
    });
    if (!batch) throw new NotFoundException('Batch not found');

    const jobs = await this.prisma.job.findMany({
      where: { batchId },
      include: {
        serverInstance: true,
        jobRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    return jobs.map((j) => {
      const run = j.jobRuns[0];
      const result = (run?.result as { errorMessage?: string } | null) ?? undefined;
      return {
        jobId: j.id,
        serverInstanceId: j.serverInstanceId ?? '',
        serverName: j.serverInstance?.name,
        runId: run?.id ?? '',
        runStatus: run?.status ?? 'pending',
        runFinishedAt: run?.finishedAt?.toISOString() ?? null,
        errorMessage: result?.errorMessage,
      };
    });
  }

  /** Called when a job run completes (success/failed/cancelled). Updates batch counts and emits progress.
   * @param priorRunStatus - Status of the run *before* completion (used to decrement the correct batch counter).
   */
  async recordJobRunCompleted(
    orgId: string,
    jobId: string,
    runStatus: 'success' | 'failed' | 'cancelled',
    priorRunStatus: 'pending' | 'running',
  ): Promise<void> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, orgId },
      include: { batch: true },
    });
    if (!job?.batchId || !job.batch) return;

    const batchId = job.batch.id;
    const updates: {
      pendingCount?: { decrement: number };
      runningCount?: { decrement: number };
      successCount?: { increment: number };
      failedCount?: { increment: number };
      cancelledCount?: { increment: number };
      status?: string;
      completedAt?: Date;
    } = {};

    if (runStatus === 'success') {
      updates.successCount = { increment: 1 };
    } else if (runStatus === 'failed') {
      updates.failedCount = { increment: 1 };
    } else {
      updates.cancelledCount = { increment: 1 };
    }

    if (priorRunStatus === 'running') {
      updates.runningCount = { decrement: 1 };
    } else {
      updates.pendingCount = { decrement: 1 };
    }

    const updated = await this.prisma.jobBatch.update({
      where: { id: batchId },
      data: updates,
    });

    let final = updated;
    if (updated.pendingCount <= 0 && updated.runningCount <= 0) {
      const status =
        updated.failedCount > 0
          ? 'completed_with_failures'
          : 'completed';
      final = await this.prisma.jobBatch.update({
        where: { id: batchId },
        data: { status, completedAt: new Date() },
      });
    }
    this.emitProgress(orgId, final, { jobId, runStatus });
  }

  /** Mark a run as running (called when agent picks the job). */
  async recordJobRunStarted(orgId: string, jobId: string): Promise<void> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, orgId },
      include: { batch: true },
    });
    if (!job?.batchId || !job.batch) return;

    await this.prisma.jobBatch.update({
      where: { id: job.batch.id },
      data: {
        pendingCount: { decrement: 1 },
        runningCount: { increment: 1 },
      },
    });

    const updated = await this.prisma.jobBatch.findUnique({
      where: { id: job.batch.id },
    });
    if (updated) this.emitProgress(orgId, updated, { jobId, runStatus: 'running' });
  }

  async cancelBatch(orgId: string, batchId: string): Promise<BatchSummaryDto> {
    const batch = await this.prisma.jobBatch.findFirst({
      where: { id: batchId, orgId },
      include: { jobs: { include: { jobRuns: { orderBy: { createdAt: 'desc' }, take: 1 } } } },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.status !== 'running') {
      throw new BadRequestException('Batch is not running');
    }

    const queue = this.getOrgQueue(orgId);
    let cancelled = 0;

    for (const job of batch.jobs) {
      const run = job.jobRuns[0];
      if (run?.status !== 'pending') continue;

      await this.prisma.jobRun.update({
        where: { id: run.id },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      try {
        const bullJob = await queue.getJob(run.id);
        if (bullJob) await bullJob.remove();
      } catch {
        // Job may already be taken by worker
      }
      cancelled++;
    }

    const updated = await this.prisma.jobBatch.update({
      where: { id: batchId },
      data: {
        status: 'cancelled',
        pendingCount: { decrement: cancelled },
        cancelledCount: { increment: cancelled },
        completedAt: new Date(),
      },
    });

    await this.audit(orgId, null, 'batch_cancelled', batchId, {
      remainingPending: batch.pendingCount - cancelled,
      cancelledCount: cancelled,
    });

    this.emitProgress(orgId, updated);
    return this.toSummary(updated);
  }

  private toSummary(b: { id: string; orgId: string; type: string; status: string; totalCount: number; pendingCount: number; runningCount: number; successCount: number; failedCount: number; cancelledCount: number; createdById: string | null; createdAt: Date; completedAt: Date | null }): BatchSummaryDto {
    return {
      id: b.id,
      orgId: b.orgId,
      type: b.type,
      status: b.status,
      totalCount: b.totalCount,
      pendingCount: b.pendingCount,
      runningCount: b.runningCount,
      successCount: b.successCount,
      failedCount: b.failedCount,
      cancelledCount: b.cancelledCount,
      createdById: b.createdById,
      createdAt: b.createdAt.toISOString(),
      completedAt: b.completedAt?.toISOString() ?? null,
    };
  }

  private emitProgress(
    orgId: string,
    batch: { id: string; status: string; totalCount: number; pendingCount: number; runningCount: number; successCount: number; failedCount: number; cancelledCount: number; completedAt: Date | null },
    updatedRun?: { jobId: string; runStatus: string },
  ): void {
    this.progressEmitter?.emitToOrg(orgId, BATCH_PROGRESS, {
      batchId: batch.id,
      status: batch.status,
      totalCount: batch.totalCount,
      pendingCount: batch.pendingCount,
      runningCount: batch.runningCount,
      successCount: batch.successCount,
      failedCount: batch.failedCount,
      cancelledCount: batch.cancelledCount,
      completedAt: batch.completedAt?.toISOString() ?? null,
      updatedRun,
    });
  }

  private async audit(
    orgId: string,
    actorId: string | null,
    action: string,
    resourceId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        action,
        resourceType: 'job_batch',
        resourceId,
        details,
      },
    });
  }

  private async auditJob(
    orgId: string,
    actorId: string | null,
    action: string,
    resourceId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        action,
        resourceType: 'job',
        resourceId,
        details,
      },
    });
  }
}
