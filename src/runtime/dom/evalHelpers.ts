import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { scriptExecutionError } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Type guard to validate CDP Runtime.evaluate response structure
 *
 * @param value - Value to check
 * @returns True if value is a valid Protocol.Runtime.EvaluateResponse
 */
function isRuntimeEvaluateResult(value: unknown): value is Protocol.Runtime.EvaluateResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (!('result' in obj) && !('exceptionDetails' in obj)) {
    return false;
  }

  if ('exceptionDetails' in obj) {
    const exceptionDetails = obj['exceptionDetails'];
    if (typeof exceptionDetails !== 'object' || exceptionDetails === null) {
      return false;
    }

    const details = exceptionDetails as Record<string, unknown>;
    if ('exception' in details) {
      const exception = details['exception'];
      if (typeof exception !== 'object' || exception === null) {
        return false;
      }

      const exObj = exception as Record<string, unknown>;
      if ('description' in exObj && typeof exObj['description'] !== 'string') {
        return false;
      }
    }
  }

  if ('result' in obj) {
    const result = obj['result'];
    if (typeof result !== 'object' || result === null) {
      return false;
    }
  }

  return true;
}

/**
 * Execute JavaScript in browser context via CDP
 *
 * @param cdp - CDP connection instance
 * @param script - JavaScript expression to execute
 * @returns Execution result
 * @throws Error When script execution throws exception or returns invalid response
 */
export async function executeScript(
  cdp: CDPConnection,
  script: string
): Promise<Protocol.Runtime.EvaluateResponse> {
  const response = await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    awaitPromise: true,
  });

  if (!isRuntimeEvaluateResult(response)) {
    throw new CommandError(
      'Invalid CDP Runtime.evaluate response structure',
      {
        suggestion:
          'CDP response did not match expected format. This may indicate a CDP protocol version mismatch',
      },
      EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }

  if (response.exceptionDetails) {
    const errorMsg =
      response.exceptionDetails.exception?.description ?? 'Unknown error executing script';
    const err = scriptExecutionError(errorMsg, script);
    // User-authored script threw — classify as invalid arguments, not software
    // error. SOFTWARE_ERROR (110) is reserved for bdg bugs; a ReferenceError
    // from user code is not a bdg crash.
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

  return response;
}
