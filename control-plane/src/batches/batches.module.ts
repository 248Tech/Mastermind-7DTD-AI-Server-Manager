import { Module, Injectable } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BatchesController } from './batches.controller';
import { BatchesService, IBatchProgressEmitter, BATCH_PROGRESS_EMITTER } from './batches.service';
import { PrismaService } from '../prisma.service';

/** No-op progress emitter when no WebSocket gateway is provided. */
@Injectable()
class NoOpBatchProgressEmitter implements IBatchProgressEmitter {
  emitToOrg(_orgId: string, _event: string, _payload: unknown): void {}
}

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-user-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [BatchesController],
  providers: [
    BatchesService,
    PrismaService,
    {
      provide: BATCH_PROGRESS_EMITTER,
      useClass: NoOpBatchProgressEmitter,
    },
  ],
  exports: [BatchesService],
})
export class BatchesModule {}
