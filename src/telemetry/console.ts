/**
 * Console message collection via CDP Runtime and Log domains.
 *
 * Captures console.log, console.error, etc. and JavaScript exceptions
 * (unhandled rejections removed again when a handler is attached later)
 * with automatic nested object expansion, browser messages (failed loads,
 * CORS, security, deprecations), and the same from cross-origin iframes and
 * workers.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import { attachChildTargets } from '@/telemetry/attachedTargets.js';
import type { ConsoleMessage, CleanupFunction, StackFrame } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';

import { shouldExcludeConsoleMessage } from './filters.js';
import { expandConsoleArgs, senderFor, type CDPSender } from './objectExpander.js';
import { formatConsoleArgs, usesFormatSpecifiers } from './remoteObject.js';
import { needsAsyncExpansion } from './remoteObjectUtils.js';

type RemoteObject = Protocol.Runtime.RemoteObject;
type ConsoleAPICalledEvent = Protocol.Runtime.ConsoleAPICalledEvent;
type ExceptionThrownEvent = Protocol.Runtime.ExceptionThrownEvent;
type LogEntry = Protocol.Log.LogEntry;

/** Console message type of each browser log level */
const LOG_LEVEL_TYPES: Record<LogEntry['level'], ConsoleMessage['type']> = {
  verbose: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
};

const log = createLogger('console');

interface MessageContext {
  navigationId: number | undefined;
  stackTrace: StackFrame[] | undefined;
  source?: LogEntry['source'];
}

/**
 * Convert a CDP call frame to a StackFrame.
 */
function convertCallFrame(frame: Protocol.Runtime.CallFrame): StackFrame {
  const stackFrame: StackFrame = {
    url: frame.url,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber,
    scriptId: frame.scriptId,
  };
  if (frame.functionName) {
    stackFrame.functionName = frame.functionName;
  }
  return stackFrame;
}

/**
 * Convert CDP stack trace to StackFrame array.
 *
 * @param stackTrace - CDP stack trace from Runtime events
 * @returns Array of StackFrame objects, or undefined if no stack trace
 */
function convertStackTrace(stackTrace?: Protocol.Runtime.StackTrace): StackFrame[] | undefined {
  if (!stackTrace?.callFrames?.length) {
    return undefined;
  }
  return stackTrace.callFrames.map(convertCallFrame);
}

/**
 * Check if any args need async expansion (missing or truncated preview).
 *
 * @param args - Console message arguments
 * @returns True if any arg needs async expansion
 */
function hasArgsNeedingExpansion(args: RemoteObject[]): boolean {
  return args.some(needsAsyncExpansion);
}

/**
 * Create a ConsoleMessage object.
 */
function createMessage(
  type: ConsoleMessage['type'],
  text: string,
  timestamp: number,
  args: RemoteObject[] | undefined,
  context: MessageContext
): ConsoleMessage {
  return {
    type,
    text,
    timestamp,
    ...(args && { args }),
    ...(context.navigationId !== undefined && { navigationId: context.navigationId }),
    ...(context.stackTrace && { stackTrace: context.stackTrace }),
    ...(context.source && { source: context.source }),
  };
}

/**
 * Insert a message in timestamp order.
 * Messages are kept sorted by timestamp to handle async expansion delays.
 *
 * @returns False when the message limit is reached (the message is dropped)
 */
function insertMessageByTimestamp(messages: ConsoleMessage[], message: ConsoleMessage): boolean {
  if (messages.length >= MAX_CONSOLE_MESSAGES) {
    log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
    return false;
  }

  const insertIndex = findInsertIndex(messages, message.timestamp);
  messages.splice(insertIndex, 0, message);
  return true;
}

/**
 * Find the correct insertion index to maintain timestamp order.
 * Uses binary search for efficiency.
 */
function findInsertIndex(messages: ConsoleMessage[], timestamp: number): number {
  let low = 0;
  let high = messages.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const midMessage = messages[mid];
    if (midMessage && midMessage.timestamp <= timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/**
 * Handle a console API call event with object expansion.
 */
function handleConsoleAPICall(
  cdp: CDPSender,
  messages: ConsoleMessage[],
  params: ConsoleAPICalledEvent,
  context: MessageContext,
  includeAll: boolean
): void {
  const basicText = formatConsoleArgs(params.args);

  if (shouldExcludeConsoleMessage(basicText, params.type, includeAll)) {
    return;
  }

  if (hasArgsNeedingExpansion(params.args) && !usesFormatSpecifiers(params.args)) {
    handleExpandableMessage(cdp, messages, params, context, basicText);
  } else {
    const message = createMessage(params.type, basicText, params.timestamp, params.args, context);
    insertMessageByTimestamp(messages, message);
  }
}

/**
 * Handle a message with expandable objects.
 */
function handleExpandableMessage(
  cdp: CDPSender,
  messages: ConsoleMessage[],
  params: ConsoleAPICalledEvent,
  context: MessageContext,
  fallbackText: string
): void {
  void expandConsoleArgs(cdp, params.args)
    .then((expandedText) => {
      const message = createMessage(
        params.type,
        expandedText,
        params.timestamp,
        params.args,
        context
      );
      insertMessageByTimestamp(messages, message);
    })
    .catch((error) => {
      log.debug(`Object expansion failed, using basic text: ${String(error)}`);
      const message = createMessage(
        params.type,
        fallbackText,
        params.timestamp,
        params.args,
        context
      );
      insertMessageByTimestamp(messages, message);
    });
}

/**
 * Remove V8 stack frame lines from an error description.
 *
 * @param description - Error description: message lines followed by stack frame lines
 * @returns The message lines only
 */
function stripStackFrames(description: string): string {
  const lines = description.split('\n');
  const firstFrame = lines.findIndex((line) => /^\s+at\s/.test(line));
  return (firstFrame === -1 ? lines : lines.slice(0, firstFrame)).join('\n').trim();
}

/**
 * Build the message text for an uncaught exception, as DevTools shows it.
 *
 * CDP's `text` is usually just "Uncaught" or "Uncaught (in promise)"; the
 * actual error lives in `exception.description` (Errors) or `exception.value`
 * (thrown primitives). The description's stack frames (`    at ...` lines)
 * are dropped, since the stack is kept separately on the message; multi-line
 * error messages are kept whole.
 *
 * @param details - CDP exception details
 * @returns e.g. "Uncaught TypeError: x is not a function"
 */
export function formatExceptionText(details: Protocol.Runtime.ExceptionDetails): string {
  const exception = details.exception;
  const raw =
    exception?.description ?? (exception?.value !== undefined ? String(exception.value) : '');
  const detail = stripStackFrames(raw);
  const prefix = details.text;
  if (!detail) return prefix || 'Unknown error';
  if (!prefix || detail.startsWith(prefix)) return detail;
  return `${prefix} ${detail}`;
}

/**
 * Handle an exception thrown event.
 *
 * @returns The message added, undefined when filtered out or over the limit
 */
function handleExceptionThrown(
  messages: ConsoleMessage[],
  params: ExceptionThrownEvent,
  context: MessageContext,
  includeAll: boolean
): ConsoleMessage | undefined {
  const exception = params.exceptionDetails;
  const text = formatExceptionText(exception);

  if (shouldExcludeConsoleMessage(text, 'error', includeAll)) {
    return undefined;
  }

  const message = createMessage('error', text, params.timestamp, undefined, context);
  return insertMessageByTimestamp(messages, message) ? message : undefined;
}

/** CDP's text of an unhandled promise rejection (the only kind Chrome revokes) */
const UNHANDLED_REJECTION_TEXT = 'Uncaught (in promise)';

/**
 * Unhandled promise rejections that may still be revoked: Chrome reports a
 * rejection without a handler at the end of the task, and revokes the
 * report (`Runtime.exceptionRevoked`) when a handler is attached later, as
 * DevTools does by removing the message. `bdg dom eval` attaches its
 * handler only after the evaluation returns, so this is what keeps
 * `bdg dom eval 'Promise.reject(…)'` out of the console; a rejection
 * nothing ever handles stays.
 */
class RevocableRejections {
  /** Messages of rejections, by session and exception id, oldest first */
  private readonly pending = new Map<string, ConsoleMessage>();

  /**
   * Remember a reported exception if it is an unhandled rejection. Past
   * {@link MAX_CONSOLE_MESSAGES} rejections, the oldest is forgotten.
   *
   * @param details - Exception details
   * @param message - Its console message
   * @param sessionId - Session it was reported on (undefined: the page)
   */
  track(
    details: Protocol.Runtime.ExceptionDetails,
    message: ConsoleMessage,
    sessionId?: string
  ): void {
    if (!details.text.startsWith(UNHANDLED_REJECTION_TEXT)) return;
    this.pending.set(this.key(details.exceptionId, sessionId), message);
    if (this.pending.size <= MAX_CONSOLE_MESSAGES) return;
    const [oldest] = this.pending.keys();
    if (oldest !== undefined) this.pending.delete(oldest);
  }

  /**
   * Remove the message of a revoked rejection.
   *
   * @param messages - Console messages (updated)
   * @param exceptionId - Revoked exception
   * @param sessionId - Session it was revoked on (undefined: the page)
   */
  revoke(messages: ConsoleMessage[], exceptionId: number, sessionId?: string): void {
    const key = this.key(exceptionId, sessionId);
    const message = this.pending.get(key);
    this.pending.delete(key);
    const index = message ? messages.indexOf(message) : -1;
    if (index !== -1) messages.splice(index, 1);
  }

  /**
   * Forget the rejections of a session whose documents are gone (it
   * detached, or its contexts were cleared by a navigation): they can no
   * longer be revoked.
   *
   * @param sessionId - Session (undefined: the page)
   */
  forgetSession(sessionId?: string): void {
    const prefix = this.key('', sessionId);
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }

  /** Forget every rejection (the collection stopped). */
  clear(): void {
    this.pending.clear();
  }

  /**
   * Map key of an exception: ids are counted per session.
   *
   * @param exceptionId - Exception id ('' for the session's prefix)
   * @param sessionId - Session
   * @returns Key
   */
  private key(exceptionId: number | '', sessionId?: string): string {
    return `${sessionId ?? ''}:${exceptionId}`;
  }
}

/**
 * Handle a browser log entry (failed resource loads, CORS, security,
 * deprecations). Entries without a stack point at their resource URL.
 *
 * Worker entries are skipped: workers are attached directly, so their console
 * calls already arrive (with arguments) from the worker's own session.
 */
function handleLogEntry(
  messages: ConsoleMessage[],
  entry: LogEntry,
  navigationId: number | undefined,
  includeAll: boolean
): void {
  const type = LOG_LEVEL_TYPES[entry.level];
  if (entry.source === 'worker' || shouldExcludeConsoleMessage(entry.text, type, includeAll)) {
    return;
  }

  const location = entry.url
    ? [
        entry.lineNumber === undefined
          ? { url: entry.url, lineNumber: -1, columnNumber: -1 }
          : { url: entry.url, lineNumber: entry.lineNumber, columnNumber: 0 },
      ]
    : undefined;
  const context: MessageContext = {
    navigationId,
    stackTrace: convertStackTrace(entry.stackTrace) ?? location,
    source: entry.source,
  };
  insertMessageByTimestamp(
    messages,
    createMessage(type, entry.text, entry.timestamp, undefined, context)
  );
}

/**
 * Enable console and log events on an attached target's session.
 *
 * @param typed - Typed CDP connection
 * @param sessionId - Session of the attached target
 */
async function enableConsoleEvents(typed: TypedCDPConnection, sessionId: string): Promise<void> {
  await typed.send('Runtime.enable', {}, sessionId);
  await typed.send('Log.enable', {}, sessionId);
}

/**
 * Enable browser log entries and attach to iframes and workers. Both only add
 * messages, so a failure is logged and the session keeps the page's console.
 *
 * @param cdp - CDP connection
 * @param typed - Typed CDP connection
 * @returns Cleanup that stops attaching to new targets
 */
async function startOptionalSources(
  cdp: CDPConnection,
  typed: TypedCDPConnection
): Promise<CleanupFunction> {
  try {
    await typed.send('Log.enable', {});
    return await attachChildTargets(cdp, (sessionId) => enableConsoleEvents(typed, sessionId));
  } catch (error) {
    log.debug(`Browser messages or iframe/worker consoles unavailable: ${String(error)}`);
    return () => undefined;
  }
}

/**
 * Start collecting console messages, exceptions and browser log entries from
 * the page and its cross-origin iframes and workers.
 *
 * @param cdp - CDP connection instance
 * @param messages - Array to populate with console messages
 * @param includeAll - If true, disable default pattern filtering
 * @param getCurrentNavigationId - Function to get current navigation ID
 * @returns Cleanup function to remove event handlers
 */
export async function startConsoleCollection(
  cdp: CDPConnection,
  messages: ConsoleMessage[],
  includeAll: boolean = false,
  getCurrentNavigationId?: () => number
): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);

  registry.registerTyped(typed, 'Runtime.consoleAPICalled', (params, sessionId) => {
    const context: MessageContext = {
      navigationId: getCurrentNavigationId?.(),
      stackTrace: convertStackTrace(params.stackTrace),
    };
    handleConsoleAPICall(senderFor(cdp, sessionId), messages, params, context, includeAll);
  });

  const rejections = new RevocableRejections();
  registry.registerTyped(typed, 'Runtime.exceptionThrown', (params, sessionId) => {
    const context: MessageContext = {
      navigationId: getCurrentNavigationId?.(),
      stackTrace: convertStackTrace(params.exceptionDetails.stackTrace),
    };
    const message = handleExceptionThrown(messages, params, context, includeAll);
    if (message) rejections.track(params.exceptionDetails, message, sessionId);
  });

  registry.registerTyped(typed, 'Runtime.exceptionRevoked', ({ exceptionId }, sessionId) => {
    rejections.revoke(messages, exceptionId, sessionId);
  });

  registry.registerTyped(typed, 'Runtime.executionContextsCleared', (_params, sessionId) => {
    rejections.forgetSession(sessionId);
  });

  registry.registerTyped(typed, 'Target.detachedFromTarget', ({ sessionId }) => {
    rejections.forgetSession(sessionId);
  });

  registry.registerTyped(typed, 'Log.entryAdded', ({ entry }) => {
    handleLogEntry(messages, entry, getCurrentNavigationId?.(), includeAll);
  });

  try {
    await typed.send('Runtime.enable', {});
  } catch (error) {
    registry.cleanup();
    throw error;
  }
  const detachChildren = await startOptionalSources(cdp, typed);

  return async () => {
    registry.cleanup();
    rejections.clear();
    await detachChildren();
  };
}
