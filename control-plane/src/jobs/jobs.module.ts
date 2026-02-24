import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { AgentJobsController } from './agent-jobs.controller';
import { JobsService } from './jobs.service';
import { BatchesModule } from '../batches/batches.module';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [BatchesModule],
  controllers: [JobsController, AgentJobsController],
  providers: [JobsService, PrismaService],
  exports: [JobsService],
})
export class JobsModule {}
