import { Controller, Get, Header, Headers, Param, Query, StreamableFile } from '@nestjs/common';
import { PlayerAuthService } from '../player-auth/player-auth.service';
import { parseShopImageSize } from './donations.shop';
import { ShopItemsService } from './shop-items.service';

@Controller('api/player-auth/shop')
export class ShopCatalogController {
  constructor(
    private readonly players: PlayerAuthService,
    private readonly shop: ShopItemsService,
  ) {}

  @Get('status')
  status() {
    return this.players.shopStatus();
  }

  @Get('items')
  async items(@Headers('authorization') authorization?: string) {
    return this.shop.listCatalog(await this.catalogOrgId(authorization));
  }

  @Get('items/:itemId')
  async item(@Param('itemId') itemId: string, @Headers('authorization') authorization?: string) {
    return this.shop.getCatalogItem(await this.catalogOrgId(authorization), itemId);
  }

  @Get('items/:itemId/image')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(
    @Param('itemId') itemId: string,
    @Query('size') size: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const file = await this.shop.image(await this.catalogOrgId(authorization), itemId, true, parseShopImageSize(size));
    return new StreamableFile(file.stream, { type: file.mime, disposition: 'inline' });
  }

  private async catalogOrgId(authorization?: string) {
    if (authorization?.startsWith('Bearer ')) {
      const player = await this.players.requirePlayer(authorization.slice(7));
      return player.orgId;
    }
    return (await this.players.portalServer()).orgId;
  }
}
