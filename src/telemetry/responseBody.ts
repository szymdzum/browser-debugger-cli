/**
 * Response bodies as `details network` shows them: cut at a cap by default
 * (an HTML document can be hundreds of KB), dropped with `--no-body`, and
 * why there is none to print for `--body`.
 */

import { skippedBodyReason } from '@/telemetry/networkRetention.js';
import type { NetworkRequest } from '@/types.js';
import {
  bodyStillLoadingReason,
  noResponseBodyReason,
  responseBodyNotCapturedReason,
  webSocketHasNoBodyReason,
} from '@/ui/messages/networkMessages.js';

/** Characters of a response body `details network` shows by default, in human and JSON output */
export const DEFAULT_BODY_MAX = 20000;

/** How much of the response body to show */
export interface BodyOptions {
  /** Leave the response body out (`--no-body`) */
  noBody?: boolean | undefined;
  /** Characters to keep (`--body-max`; 0 = all; default {@link DEFAULT_BODY_MAX}) */
  bodyMax?: number | undefined;
}

/** A request with its response body possibly cut */
export type CappedRequest = NetworkRequest & {
  /** The response body was cut at the cap */
  bodyTruncated?: true;
  /** Characters of the whole response body (when cut) */
  bodyLength?: number;
};

/**
 * The length a body is cut at: base64 on a whole 4-character group, so
 * what is kept still decodes.
 *
 * @param max - Characters to keep
 * @param base64 - Whether the body is base64
 * @returns Length to cut at
 */
function cutLength(max: number, base64: boolean): number {
  return base64 ? max - (max % 4) : max;
}

/**
 * The request with its response body cut at the cap (`bodyTruncated`,
 * `bodyLength`), or left out with `noBody`. Skipped-body placeholders and
 * the request body stay as they are.
 *
 * @param request - Captured request
 * @param options - `--no-body`, `--body-max`
 * @returns Request to show
 */
export function capResponseBody(request: NetworkRequest, options: BodyOptions = {}): CappedRequest {
  if (options.noBody) {
    const { responseBody: _body, responseBodyBase64: _base64, ...rest } = request;
    return rest;
  }
  const body = request.responseBody;
  const max = options.bodyMax ?? DEFAULT_BODY_MAX;
  if (body === undefined || max === 0 || body.length <= max) return request;
  if (skippedBodyReason(body) !== undefined) return request;
  return {
    ...request,
    responseBody: body.slice(0, cutLength(max, request.responseBodyBase64 === true)),
    bodyTruncated: true,
    bodyLength: body.length,
  };
}

/**
 * Why a request has no response body to print (`--body`).
 *
 * @param request - Captured request
 * @returns Reason, or undefined when it has a body (an empty one too)
 */
export function missingBodyReason(request: NetworkRequest): string | undefined {
  const skipped = request.bodyNotCaptured ?? skippedBodyReason(request.responseBody);
  if (skipped !== undefined) return responseBodyNotCapturedReason(skipped);
  if (request.responseBody !== undefined) return undefined;
  if (request.resourceType === 'WebSocket') return webSocketHasNoBodyReason();
  if (request.duration === undefined) return bodyStillLoadingReason();
  return noResponseBodyReason();
}
