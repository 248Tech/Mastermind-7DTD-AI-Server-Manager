# Discord Alerts — Module Architecture

## Overview

- **One Discord webhook per org:** Stored in `Org.discordWebhookUrl`. Optional; if unset, alerts are not sent to Discord (still audited).
- **Alert service abstraction:** `AlertsService.sendAlert(type, context)` formats and delivers via the configured channel (MVP: Discord only). Design allows adding more channels (Slack, email) later.
- **Rate limiting:** Per-org (10 requests per 60s) to stay under Discord’s 30/min webhook limit.
- **Retry:** Up to 3 attempts with exponential backoff on 429 or 5xx.
- **Audit:** Every send attempt is logged in `AuditLog` (action `alert_sent`, success/failure, error if any).

## Module Layout

```
control-plane/src/
├── discord/
│   ├── discord.module.ts         # Exports DiscordService
│   ├── discord.service.ts        # send(webhookUrl, payload, rateLimitKey); rate limit + retry
│   ├── discord.constants.ts     # Rate limit (10/60s), retry (3 attempts, backoff)
│   └── discord.types.ts          # DiscordWebhookPayload, DiscordEmbed
│
├── alerts/
│   ├── alerts.module.ts          # Imports DiscordModule, Prisma; exports AlertsService
│   ├── alerts.service.ts        # sendAlert(type, context); resolve webhook, format, send, audit
│   ├── alert-types.ts           # ALERT_TYPES (SERVER_DOWN, SERVER_RESTART, AGENT_OFFLINE), AlertContext
│   ├── alert-channel.interface.ts  # IAlertChannel (abstraction for future Slack/email)
│   └── formatters/
│       └── discord-alert.formatter.ts  # formatDiscordAlert(type, context) → DiscordWebhookPayload
```

## MVP Alert Types

| Type            | When to fire (example)              | Context fields (typical)                    |
|-----------------|--------------------------------------|---------------------------------------------|
| SERVER_DOWN     | Health check fails / process gone    | orgId, serverInstanceId, serverInstanceName, hostId, hostName |
| SERVER_RESTART  | After a restart job completes        | orgId, serverInstanceId, serverInstanceName, hostId, hostName |
| AGENT_OFFLINE   | Heartbeat missed (e.g. > 2 min)      | orgId, hostId, hostName, lastHeartbeatAt    |

Callers inject `AlertsService` and call `sendAlert('AGENT_OFFLINE', { orgId, hostId, hostName, lastHeartbeatAt })` etc.

## Alert Service Abstraction

- **Public API:** `AlertsService.sendAlert(type: AlertType, context: AlertContext): Promise<{ sent: boolean; error?: string }>`.
- **Channel abstraction:** `IAlertChannel.send(destination, payload, rateLimitKey)`. `DiscordService` implements this contract (destination = webhook URL). AlertsService uses Discord only in MVP; later it can resolve channel from AlertRule (e.g. type=discord vs slack) and call the right implementation.
- **Formatting:** Per-channel formatters (e.g. `formatDiscordAlert`) produce the channel-specific payload (Discord embeds with title, color, fields). Alert types map to titles/colors in the formatter.

## Rate Limiting and Retry

- **Rate limit:** In-memory map keyed by `orgId` (or webhook URL). 10 requests per 60s per org. When exceeded, `send` returns without calling Discord; audit log records “rate limit exceeded” or similar.
- **Retry:** On 429 (Discord rate limit) or 5xx, retry up to 3 times with exponential backoff (1s, 2s, 4s, cap 10s). On success or final failure, audit once per call (not per attempt).

## Audit Log

- **Action:** `alert_sent`
- **resourceType:** `discord`
- **resourceId:** `orgId`
- **details:** `{ alertType, success, error?, serverInstanceId?, hostId? }`

## Design for Later: Interactive Commands

- Discord slash commands or message components (buttons) can be handled by a separate **Discord bot** (e.g. `discord-bot` module) that receives interactions and calls Control Plane APIs (e.g. “Restart server”, “Show status”). That flow is out of scope for the alert system; the alert system only **sends** messages to a webhook. Interactive handling would:
  - Use the same or a different Discord app/bot with a public endpoint for interactions.
  - Validate interaction and map to org (e.g. by guild or stored mapping).
  - Call existing CP APIs (jobs, server instances) and optionally reply in the channel.
