import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { poiCatalogFromAgentResult, type PoiCatalogView } from './poi-catalog';

@Injectable()
export class PoiCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async latest(orgId: string, serverInstanceId: string): Promise<{ indexedAt: string | null; catalog: PoiCatalogView }> {
    const run = await this.prisma.jobRun.findFirst({
      where: { status: 'success', job: { orgId, serverInstanceId, type: 'POI_CATALOG' } },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, result: true },
    });
    const result = run?.result && typeof run.result === 'object' ? run.result as Record<string, unknown> : {};
    const data = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    return { indexedAt: run?.finishedAt?.toISOString() ?? null, catalog: poiCatalogFromAgentResult(data) };
  }
}
