import { Injectable } from '@nestjs/common';
import type { IBatchProgressEmitter } from '../batches/batches.service';

/** Stub gateway — logs events; replace with socket.io gateway when @nestjs/platform-socket.io is added. */
@Injectable()
export class EventsGateway implements IBatchProgressEmitter {
  emitToOrg(orgId: string, event: string, payload: unknown): void {
    // TODO: broadcast via socket.io when installed
    console.log(`[ws] org:${orgId} ${event}`, JSON.stringify(payload));
  }
}
