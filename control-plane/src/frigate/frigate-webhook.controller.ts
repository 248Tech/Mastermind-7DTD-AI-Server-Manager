import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  ForbiddenException,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { clientIp } from '../common/client-ip';
import { timingSafeEqualText } from '../common/timing-safe';
import { FrigateWebhookDto } from './dto/frigate-webhook.dto';

@Controller('api/orgs/:orgId/detection/frigate')
export class FrigateWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  /**
   * Receive detection events pushed by Frigate NVR.
   * Requires a configured webhook secret on the organization. Compare in constant time.
   */
  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(
    @Param('orgId') orgId: string,
    @Body() payload: FrigateWebhookDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
    @Headers('x-webhook-secret') incomingSecret?: string,
  ): Promise<{ ok: boolean }> {
    await this.rateLimit.consumeFrigateWebhook(clientIp(req));

    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { frigateWebhookSecret: true },
    });

    if (!org) {
      throw new NotFoundException('Org not found');
    }

    const expected = org.frigateWebhookSecret?.trim() ?? '';
    if (!expected || !timingSafeEqualText(incomingSecret ?? '', expected)) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    if (payload?.type !== 'new') {
      return { ok: true };
    }

    const detection = payload.after ?? payload.before;
    if (!detection || detection.false_positive) {
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
