import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HostsService } from './hosts.service';
import { HostsController } from './hosts.controller';
import { AgentHostsController } from './agent-hosts.controller';
import { PrismaService } from '../prisma.service';
import { PairingModule } from '../pairing/pairing.module';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { ServerInstancesModule } from '../server-instances/server-instances.module';

@Module({
  imports: [
    PairingModule, // exports AgentAuthGuard and PairingService
    ServerInstancesModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [HostsController, AgentHostsController],
  providers: [HostsService, PrismaService, OrgMemberGuard],
  exports: [HostsService],
})
export class HostsModule {}
