import { BadRequestException, Controller, ForbiddenException, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { DonationsService } from './donations.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { clientIp } from '../common/client-ip';

@Controller('api/donations/stripe')
export class StripeWebhookController {
  constructor(
    private readonly donations: DonationsService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request> & { ip?: string; headers?: Record<string, string | string[] | undefined> },
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!await this.donations.webhookConfigured()) throw new ForbiddenException('Stripe webhook is not configured');
    await this.rateLimit.consumeStripeWebhook(clientIp(req));
    const rawBody = req.rawBody;
    if (!rawBody?.length) throw new BadRequestException('Invalid Stripe signature');
    return this.donations.handleWebhook(rawBody, signature);
  }
}
