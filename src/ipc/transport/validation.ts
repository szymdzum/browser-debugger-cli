/**
 * Response Validation
 *
 * Validates IPC response messages match request expectations.
 */

type WithSessionId = { sessionId: string };
type WithType = { type: string };

/**
 * Validate response session ID matches request.
 */
export function validateSessionId<TReq extends WithSessionId, TRes extends WithSessionId>(
  request: TReq,
  response: TRes,
  requestName: string
): void {
  if (response.sessionId !== request.sessionId) {
    throw new Error(`${requestName} response sessionId mismatch`);
  }
}

/**
 * Validate response type matches expected type.
 */
export function validateResponseType<T extends WithType>(
  response: T,
  expectedType: string,
  requestName: string
): void {
  if (response.type !== expectedType) {
    throw new Error(
      `${requestName} unexpected response type: ${response.type} (expected ${expectedType})`
    );
  }
}
