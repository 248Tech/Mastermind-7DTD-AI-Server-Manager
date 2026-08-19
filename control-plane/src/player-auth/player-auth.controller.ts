import { Body, Controller, Get, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { PlayerAuthService } from './player-auth.service';
import { AuthRateLimitService } from '../auth/auth-rate-limit.service';
import { clientIp } from '../common/client-ip';
import { SteamVerifyDto } from './dto/steam-verify.dto';
import { NameAuthDto } from './dto/name-auth.dto';
import { AllocsService } from '../allocs/allocs.service';

@Controller('api/player-auth')
export class PlayerAuthController {
  constructor(
    private readonly auth: PlayerAuthService,
    private readonly rateLimit: AuthRateLimitService,
    private readonly allocs: AllocsService,
  ) {}

  @Post('steam/verify')
  async verify(
    @Body() body: SteamVerifyDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumeSteamVerify(clientIp(req));
    return this.auth.verifySteam(body.serverInstanceId, body.returnTo, body.openid ?? {});
  }

  @Post('register')
  async register(
    @Body() body: NameAuthDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumePlayerPortalRegister(clientIp(req));
    return this.auth.registerName(body);
  }

  @Post('login')
  async login(
    @Body() body: NameAuthDto,
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  ) {
    await this.rateLimit.consumePlayerPortalLogin(clientIp(req));
    return this.auth.loginName(body);
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    return this.auth.profile(authorization.slice(7));
  }

  @Get('places')
  places(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('Player session required');
    return this.auth.places(authorization.slice(7));
  }

  @Get('map/entities')
  async mapEntities(@Headers('authorization') authorization?: string) {
    let includePlayers = false;
    if (authorization?.startsWith('Bearer ')) {
      try {
        const player = await this.auth.requirePlayer(authorization.slice(7));
        includePlayers = player.sessionAuth === 'steam';
      } catch {
        includePlayers = false;
      }
    }
    return this.allocs.playerMapEntities(includePlayers);
  }
}
