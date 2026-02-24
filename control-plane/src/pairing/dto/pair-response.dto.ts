/**
 * Agent: response after successful pairing.
 * Agent must store agentKey and use it as Bearer token for all future requests.
 */
export class PairResponseDto {
  hostId: string;
  agentKey: string;
}
