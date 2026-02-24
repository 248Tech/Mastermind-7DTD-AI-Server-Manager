import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { DiscordModule } from '../discord/discord.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [DiscordModule],
  providers: [AlertsService, PrismaService],
  exports: [AlertsService],
})
export class AlertsModule {}
