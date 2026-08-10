import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';
import { HealthMonitorController } from './health-monitor.controller';
import { HealthMonitorService } from './health-monitor.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' })],
  controllers: [HealthMonitorController],
  providers: [HealthMonitorService, PrismaService, OrgMemberGuard, RequireOrgRoleGuard],
})
export class HealthMonitorModule {}
