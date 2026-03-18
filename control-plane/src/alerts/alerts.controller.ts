import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Controller('api/orgs/:orgId/alerts')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    return this.alertsService.listRules(orgId);
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { name: string; condition: unknown; channel: unknown; enabled?: boolean },
  ) {
    if (!body.name || !body.condition || !body.channel) {
      throw new BadRequestException('name, condition, and channel are required');
    }
    return this.alertsService.createRule(orgId, body);
  }

  @Patch(':id')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; name?: string; condition?: unknown; channel?: unknown },
  ) {
    try {
      return await this.alertsService.updateRule(orgId, id, body);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update alert rule';
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('orgId') orgId: string, @Param('id') id: string) {
    try {
      await this.alertsService.deleteRule(orgId, id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to delete alert rule';
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }
}
