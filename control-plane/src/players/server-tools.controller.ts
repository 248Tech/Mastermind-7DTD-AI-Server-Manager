import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { PlayersService } from './players.service';

@Controller('api/orgs/:orgId/server-tools')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class ServerToolsController {
  constructor(private readonly players: PlayersService) {}
  @Get(':serverId')
  get(@Param('orgId') orgId:string,@Param('serverId') serverId:string){return this.players.getProtectionSettings(orgId,serverId);}
  @Patch(':serverId')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin','operator')
  update(@Param('orgId') orgId:string,@Param('serverId') serverId:string,@Body() body:Record<string,unknown>){return this.players.updateProtectionSettings(orgId,serverId,body);}
}
