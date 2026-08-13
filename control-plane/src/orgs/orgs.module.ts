import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';
import { ModAiController } from './mod-ai.controller';
import { ModAiService } from './mod-ai.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [OrgsController, ModAiController],
  providers: [OrgsService, ModAiService, PrismaService, OrgMemberGuard, RequireOrgRoleGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
