/** MVP job types for 7DTD server control */
export const JOB_TYPES = ['SERVER_START', 'SERVER_STOP', 'SERVER_RESTART'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_RUN_STATUS = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUS)[number];

export const MAX_RETRIES = 2;
export const JOB_ATTEMPTS = MAX_RETRIES + 1;

export const QUEUE_PREFIX = 'jobs';
