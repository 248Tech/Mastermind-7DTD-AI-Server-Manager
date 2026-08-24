import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { MailgunService } from '../mailgun/mailgun.service';
import { AuthRateLimitService } from './auth-rate-limit.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthRateLimitService, MailgunService, PrismaService, JwtAuthGuard],
  exports: [AuthService, AuthRateLimitService],
})
export class AuthModule {}
