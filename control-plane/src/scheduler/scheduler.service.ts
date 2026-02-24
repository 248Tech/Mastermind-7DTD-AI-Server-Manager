import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma.service';
import { getNextCronRun, clampToExecutionWindow } from './cron-next';
import type { ScheduleJobData } from './scheduler.types';

const SCHEDULER_QUEUE_NAME = 'scheduler';
const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private schedulerQueue: Queue<ScheduleJobData> | null = null;
  private worker: Worker<ScheduleJobData> | null = null;
  private orgQueues = new Map<string, Queue>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.schedulerQueue = new Queue<ScheduleJobData>(SCHEDULER_QUEUE_NAME, {
      connection: REDIS_CONNECTION,
    });
    this.worker = new Worker<ScheduleJobData>(
      SCHEDULER_QUEUE_NAME,
      (job) => this.processScheduleFire(job),
      { connection: REDIS_CONNECTION, concurrency: 5 },
    );
    this.worker.on('failed', (job, err) => this.handleWorkerFailure(job, err));
    await this.hydrateSchedules();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.schedulerQueue) await this.schedulerQueue.close();
    for (const q of this.orgQueues.values()) await q.close();
  }

  /** Load all enabled schedules and enqueue delayed jobs for next run. */
  async hydrateSchedules(): Promise<void> {
    const schedules = await this.prisma.schedule.findMany({
      where: { enabled: true },
      include: { serverInstance: { include: { host: true } } },
    });
    const now = new Date();
    for (const s of schedules) {
      const nextRun = this.computeNextRun(s, now);
      if (!nextRun) continue;
      const delayMs = Math.max(0, nextRun.getTime() - now.getTime());
      await this.schedulerQueue!.add(
        { scheduleId: s.id },
        {
          jobId: `schedule:${s.id}:${nextRun.getTime()}`,
          delay: delayMs,
        },
      );
      await this.prisma.schedule.update({
        where: { id: s.id },
        data: { nextRunAt: nextRun },
      });
    }
  }

  private computeNextRun(
    s: { cronExpression: string; executionWindowStart: string | null; executionWindowEnd: string | null },
    from: Date,
  ): Date | null {
    try {
      let next = getNextCronRun(s.cronExpression, from);
      next = clampToExecutionWindow(next, s.executionWindowStart, s.executionWindowEnd);
      return next;
    } catch {
      return null;
    }
  }

  private async processScheduleFire(job: Job<ScheduleJobData>): Promise<void> {
    const { scheduleId } = job.data;
    const schedule = await this.prisma.schedule.findUnique({
      where: { id: scheduleId },
      include: { serverInstance: { include: { host: true } } },
    });
    if (!schedule || !schedule.enabled) return;
    const hostId = schedule.serverInstance.hostId;
    const orgId = schedule.orgId;
    const serverInstanceId = schedule.serverInstanceId;

    let createdJobId: string | null = null;
    try {
      const createdJob = await this.prisma.job.create({
        data: {
          orgId,
          serverInstanceId,
          type: schedule.jobType,
          payload: schedule.payload ?? undefined,
          createdById: null,
        },
      });
      const run = await this.prisma.jobRun.create({
        data: { jobId: createdJob.id, hostId, status: 'pending' },
      });
      createdJobId = createdJob.id;

      const retryPolicy = (schedule.retryPolicy as { maxRetries?: number; backoffMs?: number }) ?? {};
      const attempts = (retryPolicy.maxRetries ?? 2) + 1;
      const backoff = retryPolicy.backoffMs ?? 2000;

      const orgQueue = this.getOrgQueue(orgId);
      await orgQueue.add(
        {
          jobId: createdJob.id,
          jobRunId: run.id,
          hostId,
          serverInstanceId,
          type: schedule.jobType,
          payload: schedule.payload ?? {},
        },
        { jobId: run.id, attempts, backoff: { type: 'fixed' as const, delay: backoff } },
      );

      const nextRun = this.computeNextRun(schedule, new Date());
      await this.prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'success',
          lastRunJobId: createdJob.id,
          runCount: { increment: 1 },
          nextRunAt: nextRun ?? undefined,
        },
      });

      if (nextRun) {
        const delayMs = Math.max(0, nextRun.getTime() - Date.now());
        await this.schedulerQueue!.add(
          { scheduleId },
          { jobId: `schedule:${scheduleId}:${nextRun.getTime()}`, delay: delayMs },
        );
      }
    } catch (err) {
      const nextRun = this.computeNextRun(schedule, new Date());
      await this.prisma.schedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'scheduler_failed',
          lastRunJobId: createdJobId,
          failureCount: { increment: 1 },
          nextRunAt: nextRun ?? undefined,
        },
      });
      if (nextRun) {
        const delayMs = Math.max(0, nextRun.getTime() - Date.now());
        await this.schedulerQueue!.add(
          { scheduleId },
          { jobId: `schedule:${scheduleId}:${Date.now()}`, delay: delayMs },
        );
      }
      throw err;
    }
  }

  private async handleWorkerFailure(job: Job<ScheduleJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const scheduleId = (job.data as ScheduleJobData).scheduleId;
    await this.prisma.schedule.update({
      where: { id: scheduleId },
      data: {
        lastRunStatus: 'scheduler_failed',
        failureCount: { increment: 1 },
      },
    });
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
}
