import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { PlayerAuthController } from './player-auth.controller';
import { PlayerAuthService } from './player-auth.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaCoreModule } from '../prismacore/prismacore.module';
import { AllocsModule } from '../allocs/allocs.module';

@Module({
  imports: [AuthModule, PrismaCoreModule, AllocsModule, JwtModule.register({ secret: process.env.PLAYER_JWT_SECRET || process.env.JWT_SECRET || 'change-me-user-secret' })],
  controllers: [PlayerAuthController],
  providers: [PlayerAuthService, PrismaService],
  exports: [PlayerAuthService],
})
export class PlayerAuthModule {}
