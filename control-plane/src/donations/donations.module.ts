import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DonationsAdminController } from './donations-admin.controller';
import { DonationsController } from './donations.controller';
import { DonationsService } from './donations.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { ShopItemsController } from './shop-items.controller';
import { ShopItemsService } from './shop-items.service';
import { ShopCatalogController } from './shop-catalog.controller';
import { PlayerAuthModule } from '../player-auth/player-auth.module';
import { AuthModule } from '../auth/auth.module';
import { DiscordModule } from '../discord/discord.module';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';

@Module({
  imports: [
    AuthModule,
    PlayerAuthModule,
    DiscordModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [DonationsController, StripeWebhookController, ShopItemsController, ShopCatalogController, DonationsAdminController],
  providers: [DonationsService, ShopItemsService, PrismaService, OrgMemberGuard, RequireOrgRoleGuard],
})
export class DonationsModule {}
