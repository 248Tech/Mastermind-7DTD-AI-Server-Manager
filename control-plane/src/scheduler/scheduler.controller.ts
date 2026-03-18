import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import type { RequestWithUser } from '../server-instances/guards/jwt-auth.guard';

@Controller('api/orgs/:orgId/schedules')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    return this.schedulerService.listSchedules(orgId);
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() body: {
      name: string;
      serverInstanceId: string;
      cronExpression: string;
      jobType: string;
      payload?: unknown;
      enabled?: boolean;
    },
    @Req() req: RequestWithUser,
  ) {
    if (!body.name || !body.serverInstanceId || !body.cronExpression || !body.jobType) {
      throw new BadRequestException('name, serverInstanceId, cronExpression, and jobType are required');
    }
    try {
      return await this.schedulerService.createSchedule(orgId, req.user!.id, body);
    } catch (e: unknown) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Failed to create schedule');
    }
  }

  @Patch(':id')
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; name?: string; cronExpression?: string; jobType?: string },
  ) {
    try {
      return await this.schedulerService.updateSchedule(orgId, id, body);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to update schedule';
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('orgId') orgId: string, @Param('id') id: string) {
    try {
      await this.schedulerService.deleteSchedule(orgId, id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to delete schedule';
      if (msg.includes('not found')) throw new NotFoundException(msg);
      throw new BadRequestException(msg);
    }
  }
}
