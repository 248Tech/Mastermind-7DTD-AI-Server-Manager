import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentAuthGuard } from './agent-auth.guard';
import { PairingController } from './pairing.controller';
import { PairingService } from './pairing.service';
import { PrismaService } from '../prisma.service';

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
  providers: [PairingService, PrismaService, AgentAuthGuard],
  exports: [PairingService, AgentAuthGuard],
})
export class PairingModule {}
