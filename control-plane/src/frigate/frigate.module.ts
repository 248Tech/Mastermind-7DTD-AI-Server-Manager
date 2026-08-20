import { Module } from '@nestjs/common';
import { FrigateWebhookController } from './frigate-webhook.controller';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [AlertsModule, AuthModule],
  controllers: [FrigateWebhookController],
  providers: [PrismaService],
})
export class FrigateModule {}
