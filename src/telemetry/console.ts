/**
 * Console message collection via CDP Runtime and Log domains.
 *
 * Captures console.log, console.error, etc. and JavaScript exceptions
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
import { expandConsoleArgs, type CDPSender } from './objectExpander.js';
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
 */
function insertMessageByTimestamp(messages: ConsoleMessage[], message: ConsoleMessage): void {
  if (messages.length >= MAX_CONSOLE_MESSAGES) {
    log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
    return;
  }

  const insertIndex = findInsertIndex(messages, message.timestamp);
  messages.splice(insertIndex, 0, message);
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
 */
function handleExceptionThrown(
  messages: ConsoleMessage[],
  params: ExceptionThrownEvent,
  context: MessageContext,
  includeAll: boolean
): void {
  const exception = params.exceptionDetails;
  const text = formatExceptionText(exception);

  if (shouldExcludeConsoleMessage(text, 'error', includeAll)) {
    return;
  }

  const message = createMessage('error', text, params.timestamp, undefined, context);
  insertMessageByTimestamp(messages, message);
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
    ? [{ url: entry.url, lineNumber: entry.lineNumber ?? 0, columnNumber: 0 }]
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
 * Bind CDP commands to the session an event came from, so its objects can be
 * expanded (attached iframes and workers own their objects).
 *
 * @param cdp - CDP connection
 * @param sessionId - Session of the attached target, undefined for the page
 * @returns Sender for that session
 */
function senderFor(cdp: CDPConnection, sessionId: string | undefined): CDPSender {
  return sessionId ? { send: (method, params) => cdp.send(method, params, sessionId) } : cdp;
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

  registry.registerTyped(typed, 'Runtime.exceptionThrown', (params) => {
    const context: MessageContext = {
      navigationId: getCurrentNavigationId?.(),
      stackTrace: convertStackTrace(params.exceptionDetails.stackTrace),
    };
    handleExceptionThrown(messages, params, context, includeAll);
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
    await detachChildren();
  };
}
