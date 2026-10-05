import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  navigationPendingError,
  pageBusyError,
  pageNavigatedDuringEvalError,
  promiseTimeoutError,
  scriptExecutionError,
  scriptTimeoutError,
} from '@/errors/messages.js';
import { pendingNavigationUrl } from '@/runtime/page/navigation.js';
import { senderFor, type CDPSender } from '@/telemetry/objectExpander.js';
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
  cdp: CDPSender,
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
  cdp: CDPSender,
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
  if (exception?.type === 'object' && exception.subtype !== 'error' && exception.preview) {
    return `Uncaught ${formatRemoteObject(exception)}`;
  }
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

/** Object subtypes shown by their short description (`button#submit`, `ArrayBuffer(8)`). */
const BRIEF_SUBTYPES = new Set(['node', 'arraybuffer', 'dataview']);

/**
 * Page-side copy of an object as JSON, keeping what JSON would lose inside
 * it: `undefined`, NaN, ±Infinity and -0 become strings, DOM nodes their
 * short description (`button#submit`), node lists and typed arrays arrays,
 * dates ISO strings, maps and sets entries, errors their message, BigInts
 * `12n`, functions `function name()`, and cycles `[Circular]` (an object
 * shared by two properties is copied twice). Works for objects of iframes
 * (other realms); lists and objects are cut after 1000 entries, and a
 * throwing getter becomes `[Error: …]`.
 */
export const JSON_SAFE_COPY_FUNCTION = `function () {
  const MAX_ITEMS = 1000;
  const ancestors = new Set();
  const kind = (value) => Object.prototype.toString.call(value).slice(8, -1);
  const isNode = (value) => typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
  const describeNode = (node) => {
    if (node.nodeType !== 1) return node.nodeName.toLowerCase();
    return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') +
      (node.classList && node.classList.length ? '.' + Array.from(node.classList).join('.') : '');
  };
  const items = (list, next) => {
    const result = [];
    let count = 0;
    for (const item of list) {
      if (count++ === MAX_ITEMS) { result.push('…'); break; }
      result.push(next(item));
    }
    return result;
  };
  const leaf = (value) => {
    if (value === undefined) return null;
    if (typeof value === 'number') {
      if (Number.isNaN(value) || !Number.isFinite(value)) return String(value);
      return Object.is(value, -0) ? '-0' : value;
    }
    if (typeof value === 'bigint') return value + 'n';
    if (typeof value === 'symbol') return value.toString();
    if (typeof value === 'function') return 'function ' + (value.name || '(anonymous)') + '()';
    return value;
  };
  const copy = (value, depth) => {
    if (value === null || typeof value !== 'object') return leaf(value);
    if (ancestors.has(value)) return '[Circular]';
    if (depth > 20) return '[…]';
    const next = (item) => copy(item, depth + 1);
    const type = kind(value);
    if (isNode(value)) return describeNode(value);
    if (value.window === value) return 'Window';
    if (type === 'Date') return isNaN(value) ? 'Invalid Date' : value.toISOString();
    if (type === 'RegExp') return String(value);
    if (type === 'Error' || value instanceof Error) return value.name + ': ' + value.message;
    ancestors.add(value);
    try {
      if (type === 'Map') return items(value, ([k, v]) => [next(k), next(v)]);
      if (type === 'Set' || type === 'NodeList' || type === 'HTMLCollection') return items(value, next);
      if (ArrayBuffer.isView(value) && type !== 'DataView') return items(value, next);
      if (Array.isArray(value)) return items(value, next);
      const result = {};
      const keys = Object.keys(value);
      for (const key of keys.slice(0, MAX_ITEMS)) {
        try { result[key] = next(value[key]); } catch (e) { result[key] = '[Error: ' + (e && e.message) + ']'; }
      }
      if (keys.length > MAX_ITEMS) result['…'] = (keys.length - MAX_ITEMS) + ' more keys';
      return result;
    } finally {
      ancestors.delete(value);
    }
  };
  return copy(this, 0);
}`;

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
  cdp: CDPSender,
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
      functionDeclaration: JSON_SAFE_COPY_FUNCTION,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (!copy.exceptionDetails) return { value: copy.result?.value, ...kind };
  } catch (error) {
    log.debug(`Could not copy eval result by value: ${getErrorMessage(error)}`);
  }
  return { value: formatRemoteObject(remote), ...kind };
}

/**
 * Wait for `work`, or fail when it takes longer than `ms`.
 *
 * @param work - Pending work (its later failure is ignored once timed out)
 * @param ms - Time limit
 * @param onTimeout - Builds the error (and may clean up) when the limit passes
 * @returns The work's result
 * @throws What `onTimeout` returns, when the limit passes first
 */
async function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => CommandError | Promise<CommandError>
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => void Promise.resolve(onTimeout()).then(reject, reject), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** What a busy target is called in messages: the page, or an iframe (`--frame`) */
export type BusyScope = 'page' | 'frame';

/**
 * Stop whatever JavaScript keeps the page busy (e.g. a loop started from a
 * timer, which `Runtime.evaluate`'s own timeout cannot reach: the script
 * waits behind it), so the page is usable again. A page that is not
 * answering because a navigation still waits for the server is left alone.
 *
 * @param cdp - CDP connection
 * @param scope - Whether the target is the page or an iframe
 * @returns The timeout error to report
 */
async function terminatePageScripts(cdp: CDPSender, scope: BusyScope): Promise<CommandError> {
  const pendingUrl = await pendingNavigationUrl(cdp).catch((error: unknown) => {
    log.debug(`Could not check for a pending navigation: ${getErrorMessage(error)}`);
    return undefined;
  });
  if (pendingUrl !== undefined) {
    const err = navigationPendingError(pendingUrl);
    return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
  }
  await cdp
    .send('Runtime.terminateExecution')
    .catch((error: unknown) => log.debug(`terminateExecution failed: ${getErrorMessage(error)}`));
  const err = pageBusyError(EVAL_TIMEOUT_MS, scope);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
}

/** How long a page gets to answer a liveness check before it counts as busy */
const LIVENESS_CHECK_MS = 2_000;

/** When {@link withBusyPageRecovery} checks the target, and what it calls it */
export interface BusyRecoveryOptions {
  /** Time after which a command that has not answered gets the target checked */
  busyAfterMs?: number;
  /** How long the target gets to answer the check */
  livenessMs?: number;
  /** The page (default) or an iframe, for messages */
  scope?: BusyScope;
}

/**
 * Whether the target answers a trivial evaluation in time.
 *
 * @param cdp - CDP connection
 * @param ms - Time limit
 * @returns False when its scripts keep it busy
 */
async function isAnswering(cdp: CDPSender, ms: number): Promise<boolean> {
  const probe = await settledWithin(
    cdp.send('Runtime.evaluate', { expression: '1', returnByValue: true }),
    ms
  );
  return probe.settled;
}

/** Chrome's messages for a command whose execution context or target went away */
const CONTEXT_LOST_PATTERN =
  /Execution context was destroyed|Inspected target navigated or closed|Cannot find context with specified id|uniqueContextId not found|Session with given id not found/i;

/**
 * Whether Chrome failed a command because the document it ran in went away
 * (navigation, a removed iframe).
 *
 * @param error - Error thrown by a CDP command
 * @returns True for a lost context
 */
export function isContextLostError(error: unknown): boolean {
  return error instanceof CDPProtocolError && CONTEXT_LOST_PATTERN.test(error.message);
}

/**
 * Run a CDP command on the page, recovering a page kept busy by its own
 * scripts. If the command has not answered when a script would have been
 * terminated, the page is checked with a trivial evaluation: a page that
 * answers is only slow (a huge screenshot or tree), so the command keeps
 * waiting; a page that does not answer has its scripts terminated, and the
 * command fails with 102 instead of hanging until the connection times out.
 *
 * @param cdp - CDP connection
 * @param command - The pending command
 * @param options - When to check the page, how long it gets to answer, what to call it
 * @returns The command's result
 * @throws CommandError (102) when the page was busy
 */
export async function withBusyPageRecovery<T>(
  cdp: CDPSender,
  command: Promise<T>,
  options: BusyRecoveryOptions = {}
): Promise<T> {
  const {
    busyAfterMs = EVAL_TIMEOUT_MS + TERMINATION_GRACE_MS,
    livenessMs = LIVENESS_CHECK_MS,
    scope = 'page',
  } = options;
  command.catch(() => undefined);
  const early = await settledWithin(command, busyAfterMs);
  if (early.settled) return early.value;
  if (await isAnswering(cdp, livenessMs)) return command;
  throw await terminatePageScripts(cdp, scope);
}

/**
 * The work's value if it settles within `ms` (its rejection is passed on).
 *
 * @param work - Pending work
 * @param ms - Time limit
 * @returns `{ settled: true, value }`, or `{ settled: false }` when time ran out
 */
async function settledWithin<T>(
  work: Promise<T>,
  ms: number
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), ms);
  });
  try {
    return await Promise.race([work.then((value) => ({ settled: true as const, value })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Where a `bdg dom eval` script runs (default: the page's main frame) */
export interface EvalTarget {
  /** Session of an attached target (out-of-process iframe) */
  sessionId?: string;
  /** Execution context of a frame (`ExecutionContextDescription.uniqueId`) */
  uniqueContextId?: string;
}

/**
 * The error for an evaluation that did not answer in time: a target that
 * still answers was only waiting for a promise that never settled
 * (`await new Promise(() => {})`); one that does not answer is busy, and its
 * scripts are terminated.
 *
 * @param cdp - CDP connection of the target
 * @param scope - Whether the script ran in the page or an iframe
 * @returns The error to report (102)
 */
async function evaluationTimeoutError(cdp: CDPSender, scope: BusyScope): Promise<CommandError> {
  if (await isAnswering(cdp, LIVENESS_CHECK_MS)) return promiseTimeout();
  return terminatePageScripts(cdp, scope);
}

/**
 * A promise the script awaited or returned did not settle in time.
 *
 * @returns Command error (102)
 */
function promiseTimeout(): CommandError {
  const err = promiseTimeoutError(EVAL_TIMEOUT_MS);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.CDP_TIMEOUT);
}

/**
 * The page navigated while a script ran.
 *
 * @returns Command error (83)
 */
function pageNavigated(): CommandError {
  const err = pageNavigatedDuringEvalError();
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Evaluate a `bdg dom eval` script.
 *
 * Runs like the DevTools console (REPL mode: top-level `const`/`let` may be
 * declared again in a later call, top-level `await` works), awaits promises,
 * terminates scripts running longer than 20 s (so the page is not left
 * frozen by e.g. an endless loop), and returns a JSON-safe value. The eval's
 * objects are released without waiting: a script that started a busy loop
 * from a timer has already returned, and the next command recovers the page.
 *
 * @param cdp - CDP connection
 * @param script - JavaScript expression
 * @param target - Session and execution context to run in (default: the page)
 * @returns Value and type
 * @throws CommandError (102) when the script was terminated or a promise did
 *   not settle, (91) when it threw, (83) when the page navigated while it ran
 *   (in a frame, Chrome's context-lost error is passed on for the caller to explain)
 */
export async function evaluateScript(
  cdp: CDPConnection,
  script: string,
  target: EvalTarget = {}
): Promise<EvalResult> {
  const session = senderFor(cdp, target.sessionId);
  const scope: BusyScope = target.uniqueContextId ? 'frame' : 'page';
  try {
    const response = await withDeadline(
      executeScript(session, script, {
        returnByValue: false,
        generatePreview: true,
        replMode: true,
        objectGroup: EVAL_OBJECT_GROUP,
        timeout: EVAL_TIMEOUT_MS,
        ...(target.uniqueContextId && { uniqueContextId: target.uniqueContextId }),
      }),
      EVAL_TIMEOUT_MS + TERMINATION_GRACE_MS,
      () => evaluationTimeoutError(session, scope)
    );
    const settled = await withDeadline(
      settlePromise(session, response.result, script),
      EVAL_TIMEOUT_MS,
      promiseTimeout
    );
    return await toEvalResult(session, settled);
  } catch (error) {
    throw scope === 'page' && isContextLostError(error) ? pageNavigated() : error;
  } finally {
    void session
      .send('Runtime.releaseObjectGroup', { objectGroup: EVAL_OBJECT_GROUP })
      .catch((error: unknown) =>
        log.debug(`Could not release eval objects: ${getErrorMessage(error)}`)
      );
  }
}
