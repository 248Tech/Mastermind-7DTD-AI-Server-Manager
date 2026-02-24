/** Retry policy for the job created from a schedule (passed to org job queue) */
export interface ScheduleRetryPolicy {
  maxRetries?: number;
  backoffMs?: number;
  backoffType?: 'fixed' | 'exponential';
}

/** Payload for BullMQ delayed job in scheduler queue */
export interface ScheduleJobData {
  scheduleId: string;
}
