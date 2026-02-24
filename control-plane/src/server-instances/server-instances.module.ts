import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServerInstancesController } from './server-instances.controller';
import { ServerInstancesService } from './server-instances.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [ServerInstancesController],
  providers: [ServerInstancesService, PrismaService],
  exports: [ServerInstancesService],
})
export class ServerInstancesModule {}
