/**
 * getQueue(orgId): return BullMQ Queue for jobs:{orgId} (lazy create).
 * addJob(orgId, data, opts): attempts 3, backoff exponential.
 * getNextJobForHost(orgId, hostId): get waiting job with data.hostId === hostId; return job data + jobRunId.
 */
export {};
