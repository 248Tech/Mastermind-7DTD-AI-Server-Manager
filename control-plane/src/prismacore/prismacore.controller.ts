import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PrismaCoreService } from './prismacore.service';
import { PRISMACORE_LAYERS, type PrismaCoreLayer } from './prismacore.types';

const ALLOWED = new Set<string>(PRISMACORE_LAYERS);

@Controller('api/orgs/:orgId/prismacore')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class PrismaCoreController {
  constructor(private readonly prismaCore: PrismaCoreService) {}

  @Get(':layer')
  get(@Param('layer') layer: string, @Query('type') type?: string) {
    if (layer === 'createadvclaims' || !ALLOWED.has(layer)) {
      throw new BadRequestException('Unknown PrismaCore layer');
    }
    return this.prismaCore.layer(layer as PrismaCoreLayer, type);
  }
}
