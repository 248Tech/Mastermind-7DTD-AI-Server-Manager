import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { HostsService } from './hosts.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { RequestWithOrgRole } from '../server-instances/guards/org-member.guard';

@Controller('api/orgs/:orgId/hosts')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

  /** List all hosts for the org. */
  @Get()
  async findAll(@Param('orgId') orgId: string) {
    return this.hostsService.findAll(orgId);
  }

  /** Get host detail including server instances. */
  @Get(':hostId')
  async findOne(@Param('orgId') orgId: string, @Param('hostId') hostId: string) {
    return this.hostsService.findOne(orgId, hostId);
  }

  @Patch(':hostId')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  rename(@Param('orgId') orgId: string, @Param('hostId') hostId: string,
    @Body() body: { name?: string }, @Req() req: RequestWithOrgRole & { user: { id: string } }) {
    return this.hostsService.rename(orgId, hostId, body.name ?? '', req.user.id);
  }

  @Delete(':hostId')
  @HttpCode(204)
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async remove(@Param('orgId') orgId: string, @Param('hostId') hostId: string,
    @Req() req: RequestWithOrgRole & { user: { id: string } }) {
    await this.hostsService.remove(orgId, hostId, req.user.id);
  }
}
