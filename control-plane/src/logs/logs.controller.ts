import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AgentAuthGuard, RequestWithAgent } from '../pairing/agent-auth.guard';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { LogsService } from './logs.service';

@Controller()
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Post('api/agent/hosts/:hostId/log')
  @UseGuards(AgentAuthGuard)
  append(@Req() req: RequestWithAgent, @Headers('x-server-instance-id') serverInstanceId: string,
         @Body() body: { content?: string }) {
    return this.logs.append(req.agentHostId!, serverInstanceId, body.content ?? '');
  }

  @Get('api/orgs/:orgId/logs')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  list(@Param('orgId') orgId: string, @Query('serverInstanceId') serverInstanceId?: string,
       @Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    return this.logs.list(orgId, serverInstanceId, limit);
  }

  @Get('api/orgs/:orgId/logs/settings')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  settings(@Param('orgId') orgId: string) {
    return this.logs.getSettings(orgId);
  }

  @Post('api/orgs/:orgId/logs/settings')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  updateSettings(@Param('orgId') orgId: string, @Body() body: { logRetentionDays?: number }) {
    return this.logs.updateSettings(orgId, body.logRetentionDays ?? 7);
  }

  @Get('api/orgs/:orgId/logs/keyword-alerts')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  keywordRules(@Param('orgId') orgId: string) { return this.logs.listKeywordRules(orgId); }

  @Post('api/orgs/:orgId/logs/keyword-alerts')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  createKeywordRule(@Param('orgId') orgId: string,
    @Body() body: { serverInstanceId: string; keyword: string; caseSensitive?: boolean }) {
    return this.logs.createKeywordRule(orgId, body.serverInstanceId, body.keyword, body.caseSensitive);
  }

  @Patch('api/orgs/:orgId/logs/keyword-alerts/:id')
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  setKeywordRule(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.logs.setKeywordRuleEnabled(orgId, id, body.enabled);
  }

  @Delete('api/orgs/:orgId/logs/keyword-alerts/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, OrgMemberGuard, RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async deleteKeywordRule(@Param('orgId') orgId: string, @Param('id') id: string) {
    await this.logs.deleteKeywordRule(orgId, id);
  }

  @Get('api/orgs/:orgId/logs/keyword-matches')
  @UseGuards(JwtAuthGuard, OrgMemberGuard)
  keywordMatches(@Param('orgId') orgId: string, @Query('serverInstanceId') serverInstanceId?: string) {
    return this.logs.listKeywordMatches(orgId, serverInstanceId);
  }
}
