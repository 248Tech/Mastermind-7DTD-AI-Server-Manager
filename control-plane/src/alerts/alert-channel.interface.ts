import type { DiscordWebhookPayload } from '../discord/discord.types';

/**
 * Abstraction for delivering an alert to a channel (Discord webhook, future: Slack, email).
 * MVP: one implementation (Discord); design allows multiple channels later.
 */
export interface IAlertChannel {
  /**
   * Deliver a formatted payload to the given destination (e.g. webhook URL).
   * @param destination - e.g. Discord webhook URL
   * @param payload - channel-specific payload (e.g. Discord embed)
   * @param rateLimitKey - key for rate limiting (e.g. orgId)
   */
  send(
    destination: string,
    payload: DiscordWebhookPayload,
    rateLimitKey: string,
  ): Promise<{ ok: true } | { ok: false; statusCode?: number; error: string }>;
}
