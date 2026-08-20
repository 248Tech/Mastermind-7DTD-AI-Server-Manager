import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { MAX_SHOP_IMAGE_BYTES, parseShopImageSize } from './donations.shop';
import { ShopItemsService } from './shop-items.service';

@Controller('api/orgs/:orgId/shop-items')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class ShopItemsController {
  constructor(private readonly shop: ShopItemsService) {}

  @Get()
  list(@Param('orgId') orgId: string) {
    return this.shop.listAdmin(orgId);
  }

  @Get(':itemId/image')
  @Header('Cache-Control', 'private, max-age=300')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('orgId') orgId: string, @Param('itemId') itemId: string, @Query('size') size?: unknown) {
    const file = await this.shop.image(orgId, itemId, false, parseShopImageSize(size));
    return new StreamableFile(file.stream, { type: file.mime, disposition: 'inline' });
  }

  @Post()
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  @UseInterceptors(FileInterceptor('image', { limits: { files: 1, fileSize: MAX_SHOP_IMAGE_BYTES } }))
  create(
    @Param('orgId') orgId: string,
    @Req() req: RequestWithUser & { body?: Record<string, unknown> },
    @UploadedFile() file?: { buffer?: Buffer },
  ) {
    return this.shop.create(orgId, req.user!.id, req.body ?? {}, file);
  }

  @Patch(':itemId')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  @UseInterceptors(FileInterceptor('image', { limits: { files: 1, fileSize: MAX_SHOP_IMAGE_BYTES } }))
  update(
    @Param('orgId') orgId: string,
    @Param('itemId') itemId: string,
    @Req() req: RequestWithUser & { body?: Record<string, unknown> },
    @UploadedFile() file?: { buffer?: Buffer },
  ) {
    return this.shop.update(orgId, req.user!.id, itemId, req.body ?? {}, file);
  }

  @Delete(':itemId')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  remove(@Param('orgId') orgId: string, @Param('itemId') itemId: string, @Req() req: RequestWithUser) {
    return this.shop.remove(orgId, req.user!.id, itemId);
  }
}
