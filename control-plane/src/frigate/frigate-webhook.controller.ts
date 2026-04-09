import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertsService } from '../alerts/alerts.service';

interface FrigateEventObject {
  id: string;
  camera: string;
  label: string;
  score: number;
  top_score: number;
  false_positive: boolean;
  start_time: number;
  end_time: number | null;
  zones: string[];
}

interface FrigateWebhookPayload {
  before: FrigateEventObject;
  after: FrigateEventObject;
  type: 'new' | 'update' | 'end';
}

@Controller('api/orgs/:orgId/detection/frigate')
export class FrigateWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * Receive detection events pushed by Frigate NVR.
   * Configure Frigate → Settings → Webhooks → URL: http://<host>/api/orgs/<orgId>/detection/frigate/webhook
   * Only fires an alert on `type: "new"` events that are not false positives.
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Param('orgId') orgId: string,
    @Body() payload: FrigateWebhookPayload,
    @Headers('x-webhook-secret') incomingSecret?: string,
  ): Promise<{ ok: boolean }> {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { frigateWebhookSecret: true, discordWebhookUrl: true },
    });

    if (!org) {
      throw new NotFoundException('Org not found');
    }

    // Validate shared secret when one is configured
    if (org.frigateWebhookSecret) {
      if (incomingSecret !== org.frigateWebhookSecret) {
        throw new ForbiddenException('Invalid webhook secret');
      }
    }

    // Only alert on brand-new detections; ignore update/end events
    if (payload?.type !== 'new') {
      return { ok: true };
    }

    const detection = payload.after ?? payload.before;
    if (!detection) {
      return { ok: true };
    }

    // Skip Frigate false-positive classifications
    if (detection.false_positive) {
      return { ok: true };
    }

    await this.alerts.sendAlert('FRIGATE_DETECTION', {
      orgId,
      frigateCamera: detection.camera,
      frigateLabel: detection.label,
      frigateScore: detection.top_score ?? detection.score,
    });

    return { ok: true };
  }
}
