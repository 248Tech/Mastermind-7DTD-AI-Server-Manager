import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JOB_ATTEMPTS } from './constants';

// BullMQ job data shape stored in queue
export interface QueueJobData {
  jobId: string;
  jobRunId: string;
  hostId: string;
  serverInstanceId?: string;
  type: string;
  payload: Record<string, unknown>;
}

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
};

@Injectable()
export class JobsQueueService implements OnModuleDestroy {
  private orgQueues = new Map<string, Queue<QueueJobData>>();

  async onModuleDestroy(): Promise<void> {
    for (const q of this.orgQueues.values()) await q.close();
    this.orgQueues.clear();
  }

  getQueue(orgId: string): Queue<QueueJobData> {
    if (!this.orgQueues.has(orgId)) {
      this.orgQueues.set(
        orgId,
        new Queue<QueueJobData>(`jobs:${orgId}`, { connection: REDIS_CONNECTION }),
      );
    }
    return this.orgQueues.get(orgId)!;
  }

  async addJob(orgId: string, data: QueueJobData): Promise<void> {
    const queue = this.getQueue(orgId);
    await queue.add(data.type, data, {
      jobId: data.jobRunId, // BullMQ job ID = jobRunId for dedup
      attempts: JOB_ATTEMPTS,
      backoff: { type: 'exponential' as const, delay: 2000 },
    });
  }

  /**
   * Get the next pending job from the org queue that matches this hostId.
   * BullMQ doesn't support per-host filtering natively, so we inspect waiting jobs.
   * For MVP (single host per org usually), this returns the first waiting job for the host.
   */
  async getNextJobForHost(orgId: string, hostId: string): Promise<QueueJobData | null> {
    const queue = this.getQueue(orgId);
    // Get waiting jobs (up to 50 to find matching hostId)
    const waiting = await queue.getJobs(['waiting', 'delayed'], 0, 50);
    for (const job of waiting) {
      if (job.data.hostId === hostId) {
        // Move job to active by promoting it
        try {
          await job.changeDelay(0); // ensure not delayed
          // We "claim" it by removing from queue; agent will submit result
          await job.remove();
          return job.data;
        } catch {
          // Job may have been taken concurrently
          continue;
        }
      }
    }
    return null;
  }
}
