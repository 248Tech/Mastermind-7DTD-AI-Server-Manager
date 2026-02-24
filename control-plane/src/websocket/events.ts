/** WebSocket event names for job lifecycle (emit to org room) */
export const JOB_CREATED = 'job.created';
export const JOB_RUN_STARTED = 'job_run.started';
export const JOB_RUN_DONE = 'job_run.done';

/** Bulk operations: batch progress (counts + optional updatedRun) */
export const BATCH_PROGRESS = 'batch.progress';

/** Log streaming: CP → UI */
export const LOG_CHUNK = 'log.chunk';
export const LOG_DROPPED = 'log.dropped';
export const LOG_STARTED = 'log.started';
export const LOG_STOPPED = 'log.stopped';
/** UI → CP subscription */
export const SUBSCRIBE_LOG = 'subscribe_log';
export const UNSUBSCRIBE_LOG = 'unsubscribe_log';
