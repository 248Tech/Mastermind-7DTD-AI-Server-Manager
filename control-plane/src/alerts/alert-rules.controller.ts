import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  NotFoundException,
  ForbiddenException,
  Req,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard, ORG_ROLE_KEY, RequestWithOrgRole } from '../server-instances/guards/org-member.guard';

class CreateAlertRuleDto {
  name!: string;
  condition!: Record<string, unknown>;
  channel!: Record<string, unknown>;
  enabled?: boolean;
}

class UpdateAlertRuleDto {
  name?: string;
  condition?: Record<string, unknown>;
  channel?: Record<string, unknown>;
  enabled?: boolean;
}

@Controller('api/orgs/:orgId/alerts')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class AlertRulesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    const rules = await this.prisma.alertRule.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map(r => ({
      id: r.id,
      orgId: r.orgId,
      name: r.name,
      condition: r.condition,
      channel: r.channel,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  @Post()
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateAlertRuleDto,
    @Req() req: RequestWithOrgRole,
  ) {
    const role = req[ORG_ROLE_KEY];
    if (role === 'viewer') throw new ForbiddenException('Viewers cannot create alert rules');

    const rule = await this.prisma.alertRule.create({
      data: {
        orgId,
        name: dto.name.trim(),
        condition: dto.condition,
        channel: dto.channel,
        enabled: dto.enabled ?? true,
      },
    });

    return {
      id: rule.id,
      orgId: rule.orgId,
      name: rule.name,
      condition: rule.condition,
      channel: rule.channel,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  @Patch(':ruleId')
  async update(
    @Param('orgId') orgId: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAlertRuleDto,
    @Req() req: RequestWithOrgRole,
  ) {
    const role = req[ORG_ROLE_KEY];
    if (role === 'viewer') throw new ForbiddenException('Viewers cannot modify alert rules');

    const existing = await this.prisma.alertRule.findUnique({ where: { id: ruleId } });
    if (!existing || existing.orgId !== orgId) throw new NotFoundException('Alert rule not found');

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const rule = await this.prisma.alertRule.update({ where: { id: ruleId }, data });

    return {
      id: rule.id,
      orgId: rule.orgId,
      name: rule.name,
      condition: rule.condition,
      channel: rule.channel,
      enabled: rule.enabled,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }

  @Delete(':ruleId')
  @HttpCode(204)
  async remove(
    @Param('orgId') orgId: string,
    @Param('ruleId') ruleId: string,
    @Req() req: RequestWithOrgRole,
  ) {
    const role = req[ORG_ROLE_KEY];
    if (role === 'viewer') throw new ForbiddenException('Viewers cannot delete alert rules');

    const existing = await this.prisma.alertRule.findUnique({ where: { id: ruleId } });
    if (!existing || existing.orgId !== orgId) throw new NotFoundException('Alert rule not found');

    await this.prisma.alertRule.delete({ where: { id: ruleId } });
  }
}
