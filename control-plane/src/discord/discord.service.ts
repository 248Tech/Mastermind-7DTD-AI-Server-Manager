import { Injectable } from '@nestjs/common';
import {
  DISCORD_RATE_LIMIT,
  DISCORD_RETRY_ATTEMPTS,
  DISCORD_RETRY_INITIAL_MS,
  DISCORD_RETRY_MAX_MS,
} from './discord.constants';
import type { DiscordWebhookPayload } from './discord.types';

/** Per-key (e.g. orgId) rate limit state */
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

@Injectable()
export class DiscordService {
  /**
   * Send a payload to a Discord webhook URL.
   * Applies rate limiting per key (orgId), retries on 429/5xx.
   */
  async send(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
    rateLimitKey: string,
  ): Promise<{ ok: true } | { ok: false; statusCode?: number; error: string }> {
    if (!this.tryConsumeRateLimit(rateLimitKey)) {
      return { ok: false, error: 'Rate limit exceeded' };
    }

    let lastError: string | undefined;
    let lastStatus: number | undefined;
    let delay = DISCORD_RETRY_INITIAL_MS;

    for (let attempt = 0; attempt < DISCORD_RETRY_ATTEMPTS; attempt++) {
      const result = await this.post(webhookUrl, payload);
      if (result.ok) {
        return { ok: true };
      }
      lastStatus = result.statusCode;
      lastError = result.error;
      if (result.statusCode === 429 || (result.statusCode && result.statusCode >= 500)) {
        await this.sleep(delay);
        delay = Math.min(delay * 2, DISCORD_RETRY_MAX_MS);
        continue;
      }
      break;
    }

    return { ok: false, statusCode: lastStatus, error: lastError ?? 'Unknown error' };
  }

  private tryConsumeRateLimit(key: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry) {
      rateLimitMap.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (now - entry.windowStart >= DISCORD_RATE_LIMIT.windowMs) {
      entry.count = 1;
      entry.windowStart = now;
      return true;
    }
    if (entry.count >= DISCORD_RATE_LIMIT.maxPerWindow) {
      return false;
    }
    entry.count++;
    return true;
  }

  private async post(
    webhookUrl: string,
    payload: DiscordWebhookPayload,
  ): Promise<{ ok: true } | { ok: false; statusCode?: number; error: string }> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        return { ok: false, statusCode: res.status, error: text.slice(0, 200) };
      }
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return { ok: false, error: err };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
