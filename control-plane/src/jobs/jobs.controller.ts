import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Controller('api/orgs/:orgId/jobs')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  /** List jobs (org-scoped, with latest JobRun). */
  @Get()
  async list(
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
  ) {
    const take = limit ? Math.min(100, parseInt(limit, 10) || 20) : 20;
    const jobs = await this.prisma.job.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        serverInstance: { select: { id: true, name: true } },
        jobRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return jobs.map((j) => ({
      id: j.id,
      orgId: j.orgId,
      batchId: j.batchId,
      serverInstanceId: j.serverInstanceId,
      serverName: j.serverInstance?.name,
      type: j.type,
      payload: j.payload,
      createdAt: j.createdAt.toISOString(),
      latestRun: j.jobRuns[0]
        ? {
            id: j.jobRuns[0].id,
            status: j.jobRuns[0].status,
            startedAt: j.jobRuns[0].startedAt?.toISOString() ?? null,
            finishedAt: j.jobRuns[0].finishedAt?.toISOString() ?? null,
            result: j.jobRuns[0].result,
          }
        : null,
    }));
  }
}
