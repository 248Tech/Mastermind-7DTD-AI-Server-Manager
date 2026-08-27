import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PrismaCoreModule } from '../prismacore/prismacore.module';
import { JobsModule } from '../jobs/jobs.module';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [PrismaCoreModule, forwardRef(() => JobsModule)],
  providers: [VehiclesService, PrismaService],
  exports: [VehiclesService],
})
export class VehiclesModule {}
