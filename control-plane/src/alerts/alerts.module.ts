import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { DiscordModule } from '../discord/discord.module';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Module({
  imports: [
    DiscordModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AlertsController],
  providers: [AlertsService, PrismaService, OrgMemberGuard],
  exports: [AlertsService],
})
export class AlertsModule {}
