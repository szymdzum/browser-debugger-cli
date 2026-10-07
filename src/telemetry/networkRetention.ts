/**
 * What the network collector keeps of a long session: the newest finished
 * requests up to a cap, and the newest response bodies up to a total size.
 */

import type { NetworkRequest } from '@/types.js';
import { bodyEvictedReason } from '@/ui/messages/networkMessages.js';

/** Counts of what the session let go at its limits */
export interface NetworkEvictions {
  /** Finished requests dropped at the request cap, oldest first */
  requestsDropped: number;
  /** Response bodies replaced by a placeholder at the total body budget, oldest first */
  bodiesEvicted: number;
}

/** Limits of {@link RequestRetention} */
export interface RetentionLimits {
  /** Finished requests kept at most */
  maxRequests: number;
  /** Total size of the stored response bodies (bytes) */
  maxTotalBodyBytes: number;
}

/**
 * Keeps finished requests, oldest first, dropping the oldest past the cap
 * (requests in flight are never in the list, so never dropped), and tracks
 * the size of their stored bodies, replacing the oldest bodies past the
 * budget with a placeholder that says why.
 *
 * Stored bodies are kept in a Map, which iterates in insertion order: its
 * first entry is the oldest body, and a dropped request's body is removed in
 * O(1). Dropping from the front of the list is `Array.shift`, which V8 does
 * without copying for arrays of this size.
 */
export class RequestRetention {
  private readonly bodySizes = new Map<NetworkRequest, number>();
  private storedBodyBytes = 0;

  /**
   * @param requests - Finished requests, oldest first (updated in place)
   * @param limits - Request cap and body budget
   * @param evictions - Counters updated on each drop and eviction
   */
  constructor(
    private readonly requests: NetworkRequest[],
    private readonly limits: RetentionLimits,
    private readonly evictions: NetworkEvictions
  ) {}

  /**
   * Add a finished request, dropping the oldest one past the cap.
   *
   * @param request - Finished request
   * @returns The dropped request, if one was
   */
  add(request: NetworkRequest): NetworkRequest | undefined {
    this.requests.push(request);
    if (this.requests.length <= this.limits.maxRequests) return undefined;
    const dropped = this.requests.shift();
    if (!dropped) return undefined;
    this.evictions.requestsDropped++;
    this.forgetBody(dropped);
    return dropped;
  }

  /**
   * Store a fetched response body on a kept request, then evict the oldest
   * bodies until the total fits the budget (a body larger than the whole
   * budget is evicted itself).
   *
   * @param request - Request the body belongs to
   * @param body - Body as Chrome returned it
   * @param base64Encoded - Whether `body` is base64
   */
  storeBody(request: NetworkRequest, body: string, base64Encoded: boolean): void {
    request.responseBody = body;
    if (base64Encoded) request.responseBodyBase64 = true;
    if (body) {
      request.decodedBodyLength = Buffer.byteLength(body, base64Encoded ? 'base64' : 'utf-8');
    }
    const size = Buffer.byteLength(body);
    this.bodySizes.set(request, size);
    this.storedBodyBytes += size;
    this.enforceBodyBudget();
  }

  /** Evict the oldest stored bodies while their total is over the budget. */
  private enforceBodyBudget(): void {
    while (this.storedBodyBytes > this.limits.maxTotalBodyBytes) {
      const oldest = this.bodySizes.keys().next();
      if (oldest.done) return;
      const request = oldest.value;
      this.forgetBody(request);
      request.responseBody = skippedBodyPlaceholder(
        bodyEvictedReason(this.limits.maxTotalBodyBytes)
      );
      delete request.responseBodyBase64;
      this.evictions.bodiesEvicted++;
    }
  }

  /**
   * Stop counting a request's stored body.
   *
   * @param request - Request whose body is let go
   */
  private forgetBody(request: NetworkRequest): void {
    const size = this.bodySizes.get(request);
    if (size === undefined) return;
    this.bodySizes.delete(request);
    this.storedBodyBytes -= size;
  }
}

const SKIPPED_BODY_PATTERN = /^\[SKIPPED: (.*)\]$/s;

/**
 * Placeholder stored instead of a response body that was not fetched.
 *
 * @param reason - Why the body was skipped
 * @returns Placeholder text shown by `bdg details`
 */
export function skippedBodyPlaceholder(reason: string): string {
  return `[SKIPPED: ${reason}]`;
}

/**
 * Extract the reason from a skipped-body placeholder.
 *
 * @param body - Stored response body
 * @returns Reason if `body` is a placeholder, otherwise undefined
 */
export function skippedBodyReason(body: string | undefined): string | undefined {
  return body === undefined ? undefined : SKIPPED_BODY_PATTERN.exec(body)?.[1];
}
