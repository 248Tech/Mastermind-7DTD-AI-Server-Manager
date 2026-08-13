import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

class CreateOrgDto {
  name!: string;
  slug!: string;
}

class UpdateOrgDto {
  @IsOptional()
  @IsString()
  discordWebhookUrl?: string;
  @IsOptional()
  @IsString()
  frigateUrl?: string;
  @IsOptional()
  @IsString()
  frigateApiKey?: string;
  @IsOptional()
  @IsString()
  frigateWebhookSecret?: string;
  @IsOptional()
  @IsBoolean()
  avoidBloodMoonRestart?: boolean;
}

class CreateOrgAccountDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsIn(['operator', 'viewer'])
  role!: 'operator' | 'viewer';
}

class ResetOrgAccountPasswordDto {
  @IsString()
  @MinLength(12)
  newPassword!: string;
}
class OpenAiSettingsDto{@IsOptional()@IsString()@MinLength(20)@MaxLength(256) apiKey?:string;@IsString()@MinLength(1)@MaxLength(100) model!:string;}

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

  @Get(':orgId/accounts')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async getAccounts(@Param('orgId') orgId: string) {
    return this.orgsService.getAccounts(orgId);
  }

  @Get(':orgId/integrations/profile-editor')
  @UseGuards(OrgMemberGuard)
  async getProfileEditorCredit(@Param('orgId') orgId: string) {
    return this.orgsService.getProfileEditorCredit(orgId);
  }

  @Post(':orgId/accounts')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async createAccount(@Param('orgId') orgId: string, @Body() dto: CreateOrgAccountDto) {
    return this.orgsService.createAccount(orgId, dto);
  }

  @Delete(':orgId/accounts/:accountId')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async deleteAccount(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
  ) {
    return this.orgsService.deleteAccount(orgId, accountId, req.user!.id);
  }

  @Patch(':orgId/accounts/:accountId/password')
  @UseGuards(OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  async resetAccountPassword(
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Req() req: RequestWithUser,
    @Body() dto: ResetOrgAccountPasswordDto,
  ) {
    return this.orgsService.resetAccountPassword(orgId, accountId, req.user!.id, dto.newPassword);
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

  @Post(':orgId/integrations/openai')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  saveOpenAi(@Param('orgId')orgId:string,@Req()req:RequestWithUser,@Body()dto:OpenAiSettingsDto){return this.orgsService.saveOpenAiSettings(orgId,req.user!.id,dto);}

  @Post(':orgId/integrations/openai/test')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  testOpenAi(@Param('orgId')orgId:string){return this.orgsService.testOpenAi(orgId);}

  @Delete(':orgId/integrations/openai')
  @UseGuards(OrgMemberGuard,RequireOrgRoleGuard)
  @RequireOrgRoles('admin')
  clearOpenAi(@Param('orgId')orgId:string){return this.orgsService.clearOpenAiSettings(orgId);}

  @Post(':orgId/detection/frigate/test')
  @UseGuards(OrgMemberGuard)
  async testFrigate(@Param('orgId') orgId: string, @Req() req: RequestWithUser) {
    return this.orgsService.testFrigateConnection(orgId, req.user!.id);
  }
}
