import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { scriptExecutionError } from '@/errors/messages.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * Per-script evaluation deadline passed to CDP as Runtime.evaluate's own
 * `timeout` parameter. Chrome terminates the script when it elapses and
 * returns `exceptionDetails`, so a runaway `while(true)` no longer wedges
 * the Runtime for subsequent calls.
 *
 * 10 s is well above normal sync/async scripts but short enough that the
 * user gets a prompt error for genuinely stuck code.
 */
const EVAL_TIMEOUT_MS = 10_000;

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
  let response: unknown;
  try {
    response = await cdp.send('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      awaitPromise: true,
      // Let Chrome terminate the script itself after the deadline. Without
      // this, cdp.send times out at 30s while the Runtime keeps spinning
      // and every subsequent call hangs the same way.
      timeout: EVAL_TIMEOUT_MS,
    });
  } catch {
    // cdp.send timeout or transport error — attempt to kill any runaway
    // execution so the next call can run, then surface a dedicated
    // CDP_TIMEOUT (102) instead of CDP_CONNECTION_FAILURE (101).
    await terminateRuntimeExecution(cdp);
    throw new CommandError(
      `Script evaluation timed out after ${EVAL_TIMEOUT_MS / 1000}s`,
      {
        suggestion:
          'Simplify the script or remove blocking loops. Runtime was terminated; retry when ready.',
      },
      EXIT_CODES.CDP_TIMEOUT
    );
  }

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
    // Chrome signals the `timeout` param elapsed by surfacing an exception
    // whose text mentions termination. Map that to CDP_TIMEOUT so agents can
    // distinguish a runaway script from a thrown error.
    if (/execution was terminated|Execution terminated/i.test(errorMsg)) {
      await terminateRuntimeExecution(cdp);
      throw new CommandError(
        `Script evaluation timed out after ${EVAL_TIMEOUT_MS / 1000}s`,
        {
          suggestion: 'Simplify the script or remove blocking loops.',
        },
        EXIT_CODES.CDP_TIMEOUT
      );
    }
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

/**
 * Kill any in-flight Runtime.evaluate so the session isn't wedged for
 * subsequent calls. Best-effort — the call itself may fail if the target
 * has disconnected; log at debug and move on.
 */
async function terminateRuntimeExecution(cdp: CDPConnection): Promise<void> {
  try {
    await cdp.send('Runtime.terminateExecution', {});
  } catch (err) {
    log.debug(`Runtime.terminateExecution failed: ${String(err)}`);
  }
}
