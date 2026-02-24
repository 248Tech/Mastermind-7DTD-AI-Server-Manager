import { Controller, Post, Body, Param } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { ReportResultDto } from './dto/report-result.dto';

@Controller('api/agent/hosts/:hostId/jobs')
export class AgentJobsController {
  constructor(private readonly jobsService: JobsService) {}

  /** Report job run completion. Call BatchesService when job is part of a batch. */
  @Post(':jobRunId/result')
  async reportResult(
    @Param('hostId') hostId: string,
    @Param('jobRunId') jobRunId: string,
    @Body() dto: ReportResultDto,
  ) {
    return this.jobsService.reportJobResult(hostId, jobRunId, dto);
  }
}
