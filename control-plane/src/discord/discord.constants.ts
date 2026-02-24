/** Discord webhook rate limit: 30 requests per minute per webhook. We use a conservative limit per org. */
export const DISCORD_RATE_LIMIT = {
  /** Max requests per window */
  maxPerWindow: 10,
  /** Window in ms */
  windowMs: 60_000,
};

/** Retry: max attempts (first + retries) */
export const DISCORD_RETRY_ATTEMPTS = 3;
/** Initial backoff ms */
export const DISCORD_RETRY_INITIAL_MS = 1000;
/** Max backoff ms */
export const DISCORD_RETRY_MAX_MS = 10_000;
