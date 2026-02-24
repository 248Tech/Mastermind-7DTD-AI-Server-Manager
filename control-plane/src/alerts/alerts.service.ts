import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { DiscordService } from '../discord/discord.service';
import { formatDiscordAlert } from './formatters/discord-alert.formatter';
import type { AlertType, AlertContext } from './alert-types';
import { ALERT_TYPES } from './alert-types';

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordService,
  ) {}

  /**
   * Send an alert for an org. Uses org's Discord webhook if configured.
   * Rate limited, retried, and audited.
   */
  async sendAlert(
    type: AlertType,
    context: AlertContext,
  ): Promise<{ sent: boolean; error?: string }> {
    if (!ALERT_TYPES.includes(type)) {
      return { sent: false, error: `Unknown alert type: ${type}` };
    }

    const org = await this.prisma.org.findUnique({
      where: { id: context.orgId },
      select: { discordWebhookUrl: true, name: true },
    });

    if (!org?.discordWebhookUrl?.trim()) {
      await this.auditAlert(context.orgId, type, context, false, 'No webhook configured');
      return { sent: false, error: 'No Discord webhook configured for org' };
    }

    const payload = formatDiscordAlert(type, { ...context, orgName: org.name });
    const result = await this.discord.send(
      org.discordWebhookUrl,
      payload,
      context.orgId,
    );

    if (result.ok) {
      await this.auditAlert(context.orgId, type, context, true);
      return { sent: true };
    }

    await this.auditAlert(context.orgId, type, context, false, result.error);
    return { sent: false, error: result.error };
  }

  private async auditAlert(
    orgId: string,
    alertType: string,
    context: AlertContext,
    success: boolean,
    error?: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId,
        action: 'alert_sent',
        resourceType: 'discord',
        resourceId: orgId,
        details: {
          alertType,
          success,
          ...(error && { error }),
          serverInstanceId: context.serverInstanceId,
          hostId: context.hostId,
        },
      },
    });
  }
}
