import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulerService } from './scheduler.service';
import { SchedulerController } from './scheduler.controller';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService, PrismaService, OrgMemberGuard],
  exports: [SchedulerService],
})
export class SchedulerModule {}
