import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import type { RequestWithOrgRole } from '../server-instances/guards/org-member.guard';

@Controller('api/orgs/:orgId/batches')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class BatchesController {
  constructor(private readonly batchesService: BatchesService) {}

  /** Create batch. Admin or Operator only. */
  @Post()
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateBatchDto,
    @Req() req: RequestWithOrgRole & { user: { id: string } },
  ) {
    return this.batchesService.createBatch(orgId, req.user?.id ?? null, dto);
  }

  /** List batches (recent first). */
  @Get()
  async list(
    @Param('orgId') orgId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? Math.min(100, parseInt(limit, 10) || 50) : 50;
    return this.batchesService.listBatches(orgId, limitNum);
  }

  /** List jobs in batch (with latest run status). Must be before :id to match. */
  @Get(':id/jobs')
  async getJobs(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.batchesService.getBatchJobs(orgId, id);
  }

  /** Get batch by id. */
  @Get(':id')
  async getOne(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.batchesService.getBatch(orgId, id);
  }

  /** Cancel batch. Admin or Operator only. */
  @Post(':id/cancel')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  async cancel(@Param('orgId') orgId: string, @Param('id') id: string) {
    return this.batchesService.cancelBatch(orgId, id);
  }
}
