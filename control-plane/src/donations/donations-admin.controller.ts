import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { DonationsService } from './donations.service';

@Controller('api/orgs/:orgId/donations')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class DonationsAdminController {
  constructor(private readonly donations: DonationsService) {}

  @Get()
  list(@Param('orgId') orgId: string, @Query('limit') limit?: string) {
    return this.donations.listCompleted(orgId, limit);
  }
}
