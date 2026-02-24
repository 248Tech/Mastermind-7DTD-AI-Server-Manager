/** Discord webhook payload (simplified). See https://discord.com/developers/docs/resources/webhook */
export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number; // decimal (e.g. 0xff0000 for red)
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string; // ISO8601
}
