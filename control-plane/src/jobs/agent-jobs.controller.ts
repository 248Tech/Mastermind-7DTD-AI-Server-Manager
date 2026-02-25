import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { ReportResultDto } from './dto/report-result.dto';
import { AgentAuthGuard } from '../pairing/agent-auth.guard';
import type { RequestWithAgent } from '../pairing/agent-auth.guard';

@Controller('api/agent/hosts/:hostId/jobs')
@UseGuards(AgentAuthGuard)
export class AgentJobsController {
  constructor(private readonly jobsService: JobsService) {}

  /** Report job run completion. Call BatchesService when job is part of a batch. Host identity from verified agent JWT. */
  @Post(':jobRunId/result')
  async reportResult(
    @Req() req: RequestWithAgent,
    @Param('jobRunId') jobRunId: string,
    @Body() dto: ReportResultDto,
  ) {
    const hostId = req.agentHostId!;
    return this.jobsService.reportJobResult(hostId, jobRunId, dto);
  }
}
