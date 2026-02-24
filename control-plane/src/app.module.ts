import { Module } from '@nestjs/common';
import { PairingModule } from './pairing/pairing.module';
import { ServerInstancesModule } from './server-instances/server-instances.module';
import { AlertsModule } from './alerts/alerts.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { BatchesModule } from './batches/batches.module';
import { JobsModule } from './jobs/jobs.module';
import { GameTypesModule } from './game-types/game-types.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    HealthModule,
    PairingModule,
    ServerInstancesModule,
    AlertsModule,
    SchedulerModule,
    BatchesModule,
    JobsModule,
    GameTypesModule,
  ],
})
export class AppModule {}
