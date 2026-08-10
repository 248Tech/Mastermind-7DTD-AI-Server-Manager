import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { HealthMonitorService } from './health-monitor.service';

@Controller('api/orgs/:orgId/health')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class HealthMonitorController {
  constructor(private readonly health: HealthMonitorService) {}

  @Get()
  dashboard(@Param('orgId') orgId: string, @Query('minutes', new ParseIntPipe({ optional: true })) minutes?: number) {
    return this.health.dashboard(orgId, minutes);
  }

  @Post('settings')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  settings(@Param('orgId') orgId: string, @Body() body: { intervalSec?: number }) {
    return this.health.updateInterval(orgId, body.intervalSec ?? 10);
  }
}
