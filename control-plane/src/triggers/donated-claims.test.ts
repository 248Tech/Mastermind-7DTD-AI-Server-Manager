import { stackedClaimCount, totalLandClaimLimit } from './donated-claims';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(stackedClaimCount(1, 2) === 3, 'stacks trigger and donated bonuses');
assert(stackedClaimCount(0, 0) === 0, 'allows zero bonus');
assert(totalLandClaimLimit(4, 1) === 5, 'adds server default and bonus');
assert(totalLandClaimLimit(0, 2) === 2, 'falls back when server default is invalid');

console.log('donated-claims tests passed');
