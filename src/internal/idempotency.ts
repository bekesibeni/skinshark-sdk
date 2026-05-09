import { randomUUID } from 'node:crypto';

/**
 * Generate an idempotency key. Uses UUIDv4 from Node's stdlib — order doesn't
 * matter for idempotency, only uniqueness.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}
