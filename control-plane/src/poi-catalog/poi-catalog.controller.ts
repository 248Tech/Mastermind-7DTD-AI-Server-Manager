import { Controller, Get, Query, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PoiCatalogService } from './poi-catalog.service';

@Controller('api/orgs/:orgId/poi-catalog')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class PoiCatalogController {
  constructor(private readonly catalog: PoiCatalogService) {}

  @Get()
  async latest(@Param('orgId') orgId: string, @Query('serverInstanceId') serverInstanceId?: string, @Query('q') query?: string) {
    if (!serverInstanceId) throw new BadRequestException('serverInstanceId is required');
    const result = await this.catalog.latest(orgId, serverInstanceId);
    const q = (query || '').trim().toLocaleLowerCase();
    const items = q ? result.catalog.items.filter((item) => item.name.toLocaleLowerCase().includes(q)) : result.catalog.items;
    return { indexedAt: result.indexedAt, count: result.catalog.count, truncated: result.catalog.truncated, items };
  }
}
