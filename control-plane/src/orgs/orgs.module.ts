import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { PrismaService } from '../prisma.service';
import { OrgMemberGuard } from '../server-instances/guards/org-member.guard';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [OrgsController],
  providers: [OrgsService, PrismaService, OrgMemberGuard],
  exports: [OrgsService],
})
export class OrgsModule {}
