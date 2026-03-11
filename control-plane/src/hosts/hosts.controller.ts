import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { HostsService } from './hosts.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

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
}
