/** MVP job types for 7DTD server control */
export const JOB_TYPES = [
  'SERVER_START',
  'SERVER_STOP',
  'SERVER_RESTART',
  'SERVER_WIPE_SAVE',
  'RCON',
  'SEND_COMMAND',
  'REGION_HEALER_START',
  'REGION_HEALER_STOP',
  'SAVE_LIST',
  'SAVE_BACKUP',
  'SAVE_RESTORE',
  'SAVE_DELETE',
  'SAVE_RETENTION',
  'PLAYER_KICK',
  'PLAYER_KICK_ALL',
  'PLAYER_BAN',
  'PLAYER_LIST_SYNC',
  'PLAYER_ADMIN_LIST',
  'PLAYER_ADMIN_PROMOTE',
  'PLAYER_ADMIN_DEMOTE',
  'MOD_LIST',
  'MOD_QUARANTINE',
  'MOD_QUARANTINE_LIST',
  'MOD_RESTORE',
  'MOD_DELETE',
  'start',
  'stop',
  'restart',
  'rcon',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_RUN_STATUS = ['pending', 'running', 'success', 'failed', 'cancelled'] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUS)[number];

export const MAX_RETRIES = 2;
export const JOB_ATTEMPTS = MAX_RETRIES + 1;

export const QUEUE_PREFIX = 'jobs';
