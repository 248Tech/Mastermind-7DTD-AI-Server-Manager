/** Accepted job type inputs from API/UI. */
export const JOB_TYPES = [
  'start',
  'stop',
  'restart',
  'rcon',
  'custom',
  'SERVER_START',
  'SERVER_STOP',
  'SERVER_RESTART',
  'RCON',
  'CUSTOM',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Canonical job types persisted and sent to agents. */
export const NORMALIZED_JOB_TYPES = ['SERVER_START', 'SERVER_STOP', 'SERVER_RESTART', 'RCON', 'custom'] as const;
export type NormalizedJobType = (typeof NORMALIZED_JOB_TYPES)[number];

/** Normalize user-facing aliases to canonical values. */
export function normalizeJobType(input: string): NormalizedJobType {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  if (lower === 'start' || raw === 'SERVER_START') return 'SERVER_START';
  if (lower === 'stop' || raw === 'SERVER_STOP') return 'SERVER_STOP';
  if (lower === 'restart' || raw === 'SERVER_RESTART') return 'SERVER_RESTART';
  if (lower === 'rcon' || raw === 'RCON') return 'RCON';
  if (lower === 'custom' || raw === 'CUSTOM') return 'custom';

  // DTO validation should prevent this path; keep a safe fallback.
  return 'custom';
}

export const JOB_RUN_STATUS = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUS)[number];

export const MAX_RETRIES = 2;
export const JOB_ATTEMPTS = MAX_RETRIES + 1;

export const QUEUE_PREFIX = 'jobs';
