import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JobsController } from './jobs.controller';
import { AgentJobsController } from './agent-jobs.controller';
import { JobsService } from './jobs.service';
import { JobsQueueService } from './jobs-queue.service';
import { BatchesModule } from '../batches/batches.module';
import { PairingModule } from '../pairing/pairing.module';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Module({
  imports: [
    BatchesModule,
    PairingModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [JobsController, AgentJobsController],
  providers: [JobsService, JobsQueueService, PrismaService, OrgMemberGuard],
  exports: [JobsService, JobsQueueService],
})
export class JobsModule {}
