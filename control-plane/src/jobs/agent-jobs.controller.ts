import { Controller, Post, Get, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JobsQueueService } from './jobs-queue.service';
import { PrismaService } from '../prisma.service';
import { ReportResultDto } from './dto/report-result.dto';
import { AgentAuthGuard } from '../pairing/agent-auth.guard';
import type { RequestWithAgent } from '../pairing/agent-auth.guard';

@Controller('api/agent/hosts/:hostId/jobs')
@UseGuards(AgentAuthGuard)
export class AgentJobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly jobsQueueService: JobsQueueService,
    private readonly prisma: PrismaService,
  ) {}

  /** Poll for the next pending job for this host. Returns { job: null } if none queued. */
  @Get('poll')
  async poll(@Req() req: RequestWithAgent) {
    const hostId = req.agentHostId!;

    // Look up the host to get orgId
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return { job: null };

    const jobData = await this.jobsQueueService.getNextJobForHost(host.orgId, hostId);
    if (!jobData) return { job: null };

    // Mark the job run as running now that the agent has claimed it
    await this.jobsService.markJobRunStarted(hostId, jobData.jobRunId);

    return { job: jobData };
  }

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
