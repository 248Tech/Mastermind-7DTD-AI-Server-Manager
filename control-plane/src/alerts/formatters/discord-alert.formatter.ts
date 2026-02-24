import type { DiscordEmbed, DiscordWebhookPayload } from '../../discord/discord.types';
import type { AlertType } from '../alert-types';
import type { AlertContext } from '../alert-types';

/** Discord embed colors (decimal) */
const COLORS = {
  SERVER_DOWN: 0xe74c3c,   // red
  SERVER_RESTART: 0xf39c12, // orange
  AGENT_OFFLINE: 0x9b59b6,  // purple
} as const;

export function formatDiscordAlert(type: AlertType, context: AlertContext): DiscordWebhookPayload {
  const embed = buildEmbed(type, context);
  return { embeds: [embed] };
}

function buildEmbed(type: AlertType, ctx: AlertContext): DiscordEmbed {
  const color = COLORS[type] ?? 0x95a5a6;
  const title = getTitle(type);
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  if (ctx.orgName) fields.push({ name: 'Org', value: ctx.orgName, inline: true });
  if (ctx.serverInstanceName) fields.push({ name: 'Server', value: ctx.serverInstanceName, inline: true });
  if (ctx.hostName) fields.push({ name: 'Host', value: ctx.hostName, inline: true });
  if (ctx.serverInstanceId) fields.push({ name: 'Server ID', value: ctx.serverInstanceId, inline: false });
  if (ctx.hostId) fields.push({ name: 'Host ID', value: ctx.hostId, inline: false });
  if (ctx.lastHeartbeatAt) fields.push({ name: 'Last heartbeat', value: String(ctx.lastHeartbeatAt), inline: false });
  if (ctx.reason) fields.push({ name: 'Reason', value: String(ctx.reason), inline: false });

  return {
    title,
    color,
    fields: fields.length ? fields : undefined,
    footer: { text: 'Mastermind Control Plane' },
    timestamp: new Date().toISOString(),
  };
}

function getTitle(type: AlertType): string {
  switch (type) {
    case 'SERVER_DOWN':
      return '🔴 Server down';
    case 'SERVER_RESTART':
      return '🟠 Server restart';
    case 'AGENT_OFFLINE':
      return '🟣 Agent offline';
    default:
      return `Alert: ${type}`;
  }
}
