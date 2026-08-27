import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RequestWithUser } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { TriggersService, type TriggerInput } from './triggers.service';

@Controller('api/orgs/:orgId/triggers')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class TriggersController {
  constructor(private readonly triggers: TriggersService) {}

  @Get('catalog')
  catalog() {
    return this.triggers.catalog();
  }

  @Get()
  list(@Param('orgId') orgId: string, @Query('serverInstanceId') serverInstanceId?: string) {
    return this.triggers.list(orgId, serverInstanceId);
  }

  @Get(':id/fires')
  listFires(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.triggers.listFires(orgId, id);
  }

  @Post()
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  create(@Param('orgId') orgId: string, @Req() req: RequestWithUser, @Body() body: TriggerInput) {
    return this.triggers.create(orgId, req.user!.id, body);
  }

  @Patch(':id')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: Partial<TriggerInput>) {
    return this.triggers.update(orgId, id, body);
  }

  @Delete(':id')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('orgId') orgId: string, @Param('id') id: string) {
    await this.triggers.remove(orgId, id);
  }
}
