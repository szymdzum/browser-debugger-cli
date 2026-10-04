import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { scriptExecutionError, scriptTimeoutError } from '@/errors/messages.js';
import { formatRemoteObject } from '@/telemetry/remoteObject.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

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
 * @param options - Runtime.evaluate options (default: return the value as JSON)
 * @returns Execution result
 * @throws Error When script execution throws exception or returns invalid response
 */
export async function executeScript(
  cdp: CDPConnection,
  script: string,
  options: Omit<Protocol.Runtime.EvaluateRequest, 'expression'> = { returnByValue: true }
): Promise<Protocol.Runtime.EvaluateResponse> {
  const startedAt = Date.now();
  let response: unknown;
  try {
    response = await cdp.send('Runtime.evaluate', {
      expression: script,
      awaitPromise: true,
      ...options,
    });
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    const timeout = options.timeout;
    if (timeout !== undefined && elapsed >= timeout && elapsed < timeout + TERMINATION_GRACE_MS) {
      const err = scriptTimeoutError(timeout);
      throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
    }
    throw error;
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

  if (response.exceptionDetails && isTerminated(response.exceptionDetails)) {
    const err = scriptTimeoutError(options.timeout ?? 0);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
  }

  if (response.exceptionDetails) {
    const errorMsg = describeException(response.exceptionDetails);
    const err = scriptExecutionError(errorMsg, script);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }

  return response;
}

/**
 * Wait for a returned promise and use its value, as `dom eval` always has
 * (REPL mode awaits top-level `await` but returns a promise value as is).
 *
 * @param cdp - CDP connection
 * @param result - Evaluation result
 * @param script - The script (for error messages)
 * @returns The promise's value, or `result` if it is not a promise
 * @throws CommandError (91) when the promise rejects
 */
async function settlePromise(
  cdp: CDPConnection,
  result: Protocol.Runtime.RemoteObject,
  script: string
): Promise<Protocol.Runtime.RemoteObject> {
  if (result.subtype !== 'promise' || !result.objectId) return result;
  const settled = (await cdp.send('Runtime.awaitPromise', {
    promiseObjectId: result.objectId,
    returnByValue: false,
    generatePreview: true,
  })) as Protocol.Runtime.AwaitPromiseResponse;
  if (settled.exceptionDetails) {
    const err = scriptExecutionError(describeException(settled.exceptionDetails), script);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return settled.result;
}

/**
 * Message of an exception, including thrown non-Error values (`throw "x"`).
 *
 * @param details - Exception details
 * @returns Readable message
 */
function describeException(details: Protocol.Runtime.ExceptionDetails): string {
  const exception = details.exception;
  if (exception?.description) return exception.description;
  if (exception?.value !== undefined) {
    return `Uncaught ${typeof exception.value === 'string' ? exception.value : JSON.stringify(exception.value)}`;
  }
  return details.text || 'Unknown error executing script';
}

/** Time after the limit within which a failed evaluate counts as V8 terminating it. */
const TERMINATION_GRACE_MS = 5_000;

/** How long a `bdg dom eval` script may run before V8 terminates it. */
const EVAL_TIMEOUT_MS = 20_000;

/** Object group for remote objects created by `bdg dom eval`. */
const EVAL_OBJECT_GROUP = 'bdg-eval';

/** Result of `bdg dom eval`: a JSON-safe value plus its JavaScript type. */
export interface EvalResult {
  /** JSON value, or a readable description for values JSON cannot represent */
  value: unknown;
  /** JavaScript type (`number`, `bigint`, `object`, `function`, ...) */
  type: string;
  /** Object subtype (`node`, `date`, `map`, `array`, ...) */
  subtype?: string;
}

/** Object subtypes shown as a description rather than as JSON. */
const DESCRIBED_SUBTYPES = new Set([
  'node',
  'date',
  'regexp',
  'error',
  'map',
  'set',
  'weakmap',
  'weakset',
  'promise',
  'proxy',
  'iterator',
  'generator',
]);

/** Object subtypes shown by their short description (`button#submit`, `Uint8Array(3)`). */
const BRIEF_SUBTYPES = new Set(['node', 'typedarray', 'arraybuffer', 'dataview']);

/**
 * Whether an exception is V8 terminating a script that ran too long.
 *
 * @param details - Exception details
 * @returns True for a terminated execution
 */
function isTerminated(details: Protocol.Runtime.ExceptionDetails): boolean {
  return /Execution was terminated/i.test(details.exception?.description ?? details.text);
}

/**
 * Convert an evaluation result to a JSON-safe value.
 *
 * Plain objects and arrays are copied by value; values JSON cannot represent
 * (NaN, -0, BigInt, functions, symbols, DOM nodes, dates, maps, errors, the
 * window, cyclic objects) are given as their readable description.
 *
 * @param cdp - CDP connection
 * @param remote - Remote object returned by Runtime.evaluate
 * @returns Value and type
 */
async function toEvalResult(
  cdp: CDPConnection,
  remote: Protocol.Runtime.RemoteObject
): Promise<EvalResult> {
  const kind = { type: remote.type, ...(remote.subtype && { subtype: remote.subtype }) };
  if (remote.unserializableValue !== undefined)
    return { value: remote.unserializableValue, ...kind };
  if (remote.type === 'undefined') return { value: undefined, ...kind };
  if (!remote.objectId || remote.subtype === 'null')
    return { value: remote.value ?? null, ...kind };
  if (BRIEF_SUBTYPES.has(remote.subtype ?? '')) {
    return { value: remote.description ?? remote.subtype, ...kind };
  }
  if (remote.type !== 'object' || DESCRIBED_SUBTYPES.has(remote.subtype ?? '')) {
    return { value: formatRemoteObject(remote), ...kind };
  }
  try {
    const copy = (await cdp.send('Runtime.callFunctionOn', {
      objectId: remote.objectId,
      functionDeclaration: 'function () { return this; }',
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (!copy.exceptionDetails) return { value: copy.result?.value, ...kind };
  } catch (error) {
    log.debug(`Could not copy eval result by value: ${getErrorMessage(error)}`);
  }
  return { value: formatRemoteObject(remote), ...kind };
}

/**
 * Evaluate a `bdg dom eval` script.
 *
 * Runs like the DevTools console (REPL mode: top-level `const`/`let` may be
 * declared again in a later call, top-level `await` works), awaits promises,
 * terminates scripts running longer than 20 s (so the page is not left
 * frozen by e.g. an endless loop), and returns a JSON-safe value.
 *
 * @param cdp - CDP connection
 * @param script - JavaScript expression
 * @returns Value and type
 * @throws CommandError (102) when the script was terminated, (110) when it threw
 */
export async function evaluateScript(cdp: CDPConnection, script: string): Promise<EvalResult> {
  try {
    const response = await executeScript(cdp, script, {
      returnByValue: false,
      generatePreview: true,
      replMode: true,
      objectGroup: EVAL_OBJECT_GROUP,
      timeout: EVAL_TIMEOUT_MS,
    });
    return await toEvalResult(cdp, await settlePromise(cdp, response.result, script));
  } finally {
    await cdp
      .send('Runtime.releaseObjectGroup', { objectGroup: EVAL_OBJECT_GROUP })
      .catch((error: unknown) =>
        log.debug(`Could not release eval objects: ${getErrorMessage(error)}`)
      );
  }
}
