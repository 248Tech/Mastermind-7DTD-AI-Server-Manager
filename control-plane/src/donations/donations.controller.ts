import { Body, Controller, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { DonationsService } from './donations.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { PlayerAuthService } from '../player-auth/player-auth.service';
import { clientIp } from '../common/client-ip';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('api/player-auth/donations')
export class DonationsController {
  constructor(
    private readonly donations: DonationsService,
    private readonly players: PlayerAuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Post('checkout')
  async checkout(
    @Body() body: CreateCheckoutDto,
    @Headers('authorization') authorization?: string,
    @Req() req?: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    const token = authorization.slice(7);
    const player = await this.players.requirePlayer(token);
    await this.rateLimit.consumeDonationCheckout(clientIp(req ?? {}), player.id);
    return this.donations.createCheckout(player, body.amountCents, body.shopItemId, body.shopItemIds);
  }
}
