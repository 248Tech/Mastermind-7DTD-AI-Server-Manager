import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JobsModule } from '../jobs/jobs.module';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { TriggersController } from './triggers.controller';
import { TriggersService } from './triggers.service';

@Module({
  imports: [
    forwardRef(() => JobsModule),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [TriggersController],
  providers: [TriggersService, PrismaService, OrgMemberGuard],
  exports: [TriggersService],
})
export class TriggersModule {}
