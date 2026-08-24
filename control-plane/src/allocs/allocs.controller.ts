import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard, RequireOrgRoles } from '../server-instances/guards/require-org-role.guard';
import { AllocsService } from './allocs.service';
import { AllocsConsoleDto } from './dto/allocs-console.dto';

@Controller('api/orgs/:orgId/allocs')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
export class AllocsController {
  constructor(private readonly allocs: AllocsService) {}

  @Get('entities')
  entities() {
    return this.allocs.staffEntities();
  }

  @Post('console')
  @UseGuards(RequireOrgRoleGuard)
  @RequireOrgRoles('admin', 'operator')
  console(@Body() body: AllocsConsoleDto) {
    return this.allocs.executeAllowed(body.command);
  }
}
