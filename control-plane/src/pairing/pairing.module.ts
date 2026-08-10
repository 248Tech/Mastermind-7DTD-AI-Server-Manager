import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentAuthGuard } from './agent-auth.guard';
import { PairingController } from './pairing.controller';
import { PairingService } from './pairing.service';
import { PrismaService } from '../prisma.service';
import { JwtAuthGuard } from '../server-instances/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { RequireOrgRoleGuard } from '../server-instances/guards/require-org-role.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_AGENT_SECRET || process.env.JWT_SECRET || 'change-me-agent-secret',
      signOptions: {
        expiresIn: '365d', // agent keys long-lived; rotation invalidates
      },
    }),
  ],
  controllers: [PairingController],
  providers: [
    PairingService,
    PrismaService,
    AgentAuthGuard,
    JwtAuthGuard,
    OrgMemberGuard,
    RequireOrgRoleGuard,
  ],
  exports: [PairingService, AgentAuthGuard],
})
export class PairingModule {}
