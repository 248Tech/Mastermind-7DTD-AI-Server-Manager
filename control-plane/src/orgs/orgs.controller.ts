import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

class CreateOrgDto {
  name!: string;
  slug!: string;
}

@Controller('api/orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  /** Create a new org. The requesting user becomes admin. */
  @Post()
  async createOrg(@Body() dto: CreateOrgDto, @Req() req: RequestWithUser) {
    return this.orgsService.createOrg(dto.name, dto.slug, req.user!.id);
  }

  /** List all orgs the current user is a member of. */
  @Get()
  async getUserOrgs(@Req() req: RequestWithUser) {
    return this.orgsService.getUserOrgs(req.user!.id);
  }

  /** Get a specific org (user must be a member). */
  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  async getOrg(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.getOrg(orgId, req.user!.id);
  }

  /** Update org settings (e.g. discordWebhookUrl). User must be a member. */
  @Patch(':orgId')
  @UseGuards(OrgMemberGuard)
  async updateOrg(
    @Param('orgId') orgId: string,
    @Body() body: { discordWebhookUrl?: string | null },
    @Req() req: RequestWithUser,
  ) {
    return this.orgsService.updateOrg(orgId, req.user!.id, body);
  }
}
