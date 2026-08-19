import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PrismaCoreController } from './prismacore.controller';
import { PrismaCoreService } from './prismacore.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' })],
  controllers: [PrismaCoreController],
  providers: [PrismaCoreService, PrismaService, OrgMemberGuard, JwtAuthGuard],
  exports: [PrismaCoreService],
})
export class PrismaCoreModule {}
