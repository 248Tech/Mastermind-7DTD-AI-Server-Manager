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

class UpdateOrgDto {
  discordWebhookUrl?: string;
  frigateUrl?: string;
  frigateApiKey?: string;
  frigateWebhookSecret?: string;
}

@Controller('api/orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  @Post()
  async createOrg(@Body() dto: CreateOrgDto, @Req() req: RequestWithUser) {
    return this.orgsService.createOrg(dto.name, dto.slug, req.user!.id);
  }

  @Get()
  async getUserOrgs(@Req() req: RequestWithUser) {
    return this.orgsService.getUserOrgs(req.user!.id);
  }

  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  async getOrg(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.getOrg(orgId, req.user!.id);
  }

  @Patch(':orgId')
  @UseGuards(OrgMemberGuard)
  async updateOrg(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrgDto,
    @Req() req: RequestWithUser,
  ) {
    return this.orgsService.updateOrg(orgId, req.user!.id, dto);
  }

  @Post(':orgId/detection/frigate/test')
  @UseGuards(OrgMemberGuard)
  async testFrigate(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.testFrigateConnection(orgId, req.user!.id);
  }
}
