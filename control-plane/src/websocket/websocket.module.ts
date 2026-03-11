import { Global, Module } from '@nestjs/common';
import { EventsGateway } from './websocket.gateway';
import { BATCH_PROGRESS_EMITTER } from '../batches/batches.service';

@Global()
@Module({
  providers: [
    EventsGateway,
    { provide: BATCH_PROGRESS_EMITTER, useExisting: EventsGateway },
  ],
  exports: [EventsGateway, BATCH_PROGRESS_EMITTER],
})
export class WebsocketModule {}
