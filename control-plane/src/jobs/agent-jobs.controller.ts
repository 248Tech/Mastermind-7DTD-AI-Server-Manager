import { Controller, Post, Get, Body, Param, Query, Req, UseGuards, NotFoundException, BadRequestException, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { JobsService } from './jobs.service';
import { JobsQueueService } from './jobs-queue.service';
import { PrismaService } from '../prisma.service';
import { ReportResultDto } from './dto/report-result.dto';
import { ReportProgressDto } from './dto/report-progress.dto';
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

  /** Secure job artifact download. Agent identity and assigned host are verified. */
  @Get(':jobRunId/file')
  async downloadJobFile(
    @Req() req: RequestWithAgent,
    @Param('jobRunId') jobRunId: string,
  ) {
    const run = await this.prisma.jobRun.findUnique({ where: { id: jobRunId }, include: { job: true } });
    if (!run || run.hostId !== req.agentHostId) throw new NotFoundException('Job file not found');
    if (run.job.type !== 'MOD_UPLOAD_QUARANTINE') throw new BadRequestException('Job has no downloadable mod archive');
    const payload = (run.job.payload ?? {}) as Record<string, unknown>;
    const uploadId = typeof payload.uploadId === 'string' ? payload.uploadId : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
      throw new BadRequestException('Invalid mod upload reference');
    }
    const filePath = join(process.env.MOD_UPLOAD_DIR || '/var/lib/mastermind/uploads', `${uploadId}.zip`);
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Uploaded mod archive expired or is unavailable');
    return new StreamableFile(createReadStream(filePath), {
      type: 'application/zip',
      length: info.size,
      disposition: 'attachment; filename="mod-upload.zip"',
    });
  }

  /** Poll for the next pending job for this host. Returns { job: null } if none queued. */
  @Get('poll')
  async poll(@Req() req: RequestWithAgent, @Query('mutationBusy') mutationBusy?: string) {
    const hostId = req.agentHostId!;

    // Look up the host to get orgId
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return { job: null };

    const jobData = await this.jobsQueueService.getNextJobForHost(host.orgId, hostId, mutationBusy === 'true');
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

  /** Record a nonterminal agent phase while the job remains active. */
  @Post(':jobRunId/progress')
  async reportProgress(
    @Req() req: RequestWithAgent,
    @Param('jobRunId') jobRunId: string,
    @Body() dto: ReportProgressDto,
  ) {
    return this.jobsService.reportJobProgress(req.agentHostId!, jobRunId, dto.phase, dto.message);
  }
}
