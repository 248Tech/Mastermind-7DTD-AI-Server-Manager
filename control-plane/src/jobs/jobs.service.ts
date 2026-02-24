import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BatchesService } from '../batches/batches.service';
import type { ReportResultDto } from './dto/report-result.dto';

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchesService: BatchesService,
  ) {}

  /**
   * Update JobRun with agent result and optionally update batch progress.
   */
  async reportJobResult(
    hostId: string,
    jobRunId: string,
    dto: ReportResultDto,
  ): Promise<{ ok: boolean }> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run) throw new NotFoundException('Job run not found');
    if (run.hostId !== hostId) {
      throw new BadRequestException('Job run does not belong to this host');
    }
    if (run.status !== 'running') {
      throw new BadRequestException(`Job run is not running (status: ${run.status})`);
    }

    const runStatus = dto.status === 'success' ? 'success' : 'failed';
    const result = {
      durationMs: dto.durationMs,
      errorMessage: dto.errorMessage,
      output: dto.output,
    };

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: {
        status: runStatus,
        finishedAt: new Date(),
        result,
      },
    });

    const orgId = run.job.orgId;
    if (run.job.batchId) {
      await this.batchesService.recordJobRunCompleted(orgId, run.jobId, runStatus);
    }

    return { ok: true };
  }

  /**
   * Mark job run as running when agent picks it. Call from get-next-job flow.
   */
  async markJobRunStarted(hostId: string, jobRunId: string): Promise<void> {
    const run = await this.prisma.jobRun.findUnique({
      where: { id: jobRunId },
      include: { job: true },
    });
    if (!run || run.hostId !== hostId) return;
    if (run.status !== 'pending') return;

    await this.prisma.jobRun.update({
      where: { id: jobRunId },
      data: { status: 'running', startedAt: new Date() },
    });

    if (run.job.batchId) {
      await this.batchesService.recordJobRunStarted(run.job.orgId, run.jobId);
    }
  }
}
