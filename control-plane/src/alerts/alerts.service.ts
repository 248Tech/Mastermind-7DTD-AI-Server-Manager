import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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

  // ─── Alert Rule CRUD ───────────────────────────────────────────────────────

  async listRules(orgId: string) {
    const rules = await this.prisma.alertRule.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map((r) => this.toDto(r));
  }

  async createRule(
    orgId: string,
    data: { name: string; condition: unknown; channel: unknown; enabled?: boolean },
  ) {
    const rule = await this.prisma.alertRule.create({
      data: {
        orgId,
        name: data.name,
        condition: data.condition as Prisma.InputJsonValue,
        channel: data.channel as Prisma.InputJsonValue,
        enabled: data.enabled ?? true,
      },
    });
    return this.toDto(rule);
  }

  async updateRule(
    orgId: string,
    ruleId: string,
    data: { enabled?: boolean; name?: string; condition?: unknown; channel?: unknown },
  ) {
    const existing = await this.prisma.alertRule.findFirst({ where: { id: ruleId, orgId } });
    if (!existing) throw new Error('Alert rule not found');

    const updated = await this.prisma.alertRule.update({
      where: { id: ruleId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.condition !== undefined && { condition: data.condition as Prisma.InputJsonValue }),
        ...(data.channel !== undefined && { channel: data.channel as Prisma.InputJsonValue }),
      },
    });
    return this.toDto(updated);
  }

  async deleteRule(orgId: string, ruleId: string): Promise<void> {
    const existing = await this.prisma.alertRule.findFirst({ where: { id: ruleId, orgId } });
    if (!existing) throw new Error('Alert rule not found');
    await this.prisma.alertRule.delete({ where: { id: ruleId } });
  }

  private toDto(r: {
    id: string; orgId: string; name: string; condition: unknown;
    channel: unknown; enabled: boolean; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      condition: r.condition,
      channel: r.channel,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
    };
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
