import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'change-me-user-secret' }), JobsModule],
  controllers: [PlayersController], providers: [PlayersService, PrismaService, OrgMemberGuard],
})
export class PlayersModule {}
