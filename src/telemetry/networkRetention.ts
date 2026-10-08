/**
 * What the network collector keeps of a long session: the newest finished
 * requests up to a cap, and the newest request and response bodies up to a
 * total size.
 */

import type { NetworkRequest } from '@/types.js';
import { bodyEvictedReason } from '@/ui/messages/networkMessages.js';

/** Counts of what the session let go at its limits */
export interface NetworkEvictions {
  /** Finished requests dropped at the request cap, oldest first */
  requestsDropped: number;
  /** Request and response bodies replaced by a placeholder at the total body budget, oldest first */
  bodiesEvicted: number;
}

/** Limits of {@link RequestRetention} */
export interface RetentionLimits {
  /** Finished requests kept at most */
  maxRequests: number;
  /** Total size of the stored request and response bodies (bytes) */
  maxTotalBodyBytes: number;
}

/** Which body of a request is stored */
type BodyPart = 'requestBody' | 'responseBody';

/** A stored body counted against the budget */
interface StoredBody {
  request: NetworkRequest;
  part: BodyPart;
  size: number;
}

/**
 * Keeps finished requests, oldest first, dropping the oldest past the cap
 * (requests in flight are never in the list, so never dropped), and tracks
 * the size of their stored request and response bodies under one budget,
 * replacing the oldest bodies past it with a placeholder that says why.
 *
 * A request body is counted when its request finishes, a response body when
 * it is fetched. Stored bodies are kept in a Set, which iterates in insertion
 * order: its first entry is the oldest body. Each part is also indexed by
 * request, so a dropped request's bodies are removed in O(1). Dropping from
 * the front of the list is `Array.shift`, which V8 does without copying for
 * arrays of this size.
 */
export class RequestRetention {
  private readonly storedBodies = new Set<StoredBody>();
  private readonly bodiesByPart: Record<BodyPart, Map<NetworkRequest, StoredBody>> = {
    requestBody: new Map(),
    responseBody: new Map(),
  };
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
   * Add a finished request, drop the oldest request past the cap, then count
   * the new request's body against the budget.
   *
   * @param request - Finished request
   * @returns The dropped request, if one was
   */
  add(request: NetworkRequest): NetworkRequest | undefined {
    this.requests.push(request);
    const dropped = this.dropOldestPastCap();
    if (request.requestBody) {
      this.countBody(request, 'requestBody', Buffer.byteLength(request.requestBody));
    }
    return dropped;
  }

  /**
   * Drop the oldest request when the list is over the cap, with its bodies.
   *
   * @returns The dropped request, if one was
   */
  private dropOldestPastCap(): NetworkRequest | undefined {
    if (this.requests.length <= this.limits.maxRequests) return undefined;
    const dropped = this.requests.shift();
    if (!dropped) return undefined;
    this.evictions.requestsDropped++;
    this.forgetBody(dropped, 'requestBody');
    this.forgetBody(dropped, 'responseBody');
    return dropped;
  }

  /**
   * Store a fetched response body on a kept request, then evict the oldest
   * bodies until the total fits the budget (a body larger than the whole
   * budget is evicted itself). Storing a body again replaces the earlier one.
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
    this.countBody(request, 'responseBody', Buffer.byteLength(body));
  }

  /**
   * Count a stored body (replacing an earlier count of the same part), then
   * evict the oldest bodies while the total is over the budget.
   *
   * @param request - Request the body belongs to
   * @param part - Which of its bodies
   * @param size - Body size (bytes)
   */
  private countBody(request: NetworkRequest, part: BodyPart, size: number): void {
    this.forgetBody(request, part);
    const stored: StoredBody = { request, part, size };
    this.storedBodies.add(stored);
    this.bodiesByPart[part].set(request, stored);
    this.storedBodyBytes += size;
    this.enforceBodyBudget();
  }

  /** Evict the oldest stored bodies while their total is over the budget. */
  private enforceBodyBudget(): void {
    while (this.storedBodyBytes > this.limits.maxTotalBodyBytes) {
      const oldest = this.storedBodies.values().next();
      if (oldest.done) return;
      const { request, part } = oldest.value;
      this.forgetBody(request, part);
      request[part] = skippedBodyPlaceholder(bodyEvictedReason(this.limits.maxTotalBodyBytes));
      if (part === 'responseBody') delete request.responseBodyBase64;
      this.evictions.bodiesEvicted++;
    }
  }

  /**
   * Stop counting one of a request's stored bodies.
   *
   * @param request - Request whose body is let go
   * @param part - Which of its bodies
   */
  private forgetBody(request: NetworkRequest, part: BodyPart): void {
    const stored = this.bodiesByPart[part].get(request);
    if (!stored) return;
    this.bodiesByPart[part].delete(request);
    this.storedBodies.delete(stored);
    this.storedBodyBytes -= stored.size;
  }
}

const SKIPPED_BODY_PATTERN = /^\[SKIPPED: (.*)\]$/s;

/**
 * Placeholder stored instead of a body that was not fetched or not kept.
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
 * @param body - Stored request or response body
 * @returns Reason if `body` is a placeholder, otherwise undefined
 */
export function skippedBodyReason(body: string | undefined): string | undefined {
  return body === undefined ? undefined : SKIPPED_BODY_PATTERN.exec(body)?.[1];
}
