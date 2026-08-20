import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';
import { PrismaCoreModule } from '../prismacore/prismacore.module';
import { AllocsController } from './allocs.controller';
import { AllocsService } from './allocs.service';

@Module({
  imports: [
    PrismaCoreModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' }),
  ],
  controllers: [AllocsController],
  providers: [AllocsService, PrismaService, OrgMemberGuard, JwtAuthGuard, RequireOrgRoleGuard],
  exports: [AllocsService],
})
export class AllocsModule {}
