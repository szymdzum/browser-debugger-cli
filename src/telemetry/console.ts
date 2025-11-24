/**
 * Console message collection via CDP Runtime domain.
 *
 * Captures console.log, console.error, etc. and JavaScript exceptions
 * with automatic nested object expansion.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { ConsoleMessage, CleanupFunction, StackFrame } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

import { shouldExcludeConsoleMessage } from './filters.js';
import { expandConsoleArgs } from './objectExpander.js';
import { formatConsoleArgs } from './remoteObject.js';
import { needsAsyncExpansion } from './remoteObjectUtils.js';

type RemoteObject = Protocol.Runtime.RemoteObject;
type ConsoleAPICalledEvent = Protocol.Runtime.ConsoleAPICalledEvent;
type ExceptionThrownEvent = Protocol.Runtime.ExceptionThrownEvent;

const log = createLogger('console');

interface MessageContext {
  navigationId: number | undefined;
  stackTrace: StackFrame[] | undefined;
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
  cdp: CDPConnection,
  messages: ConsoleMessage[],
  params: ConsoleAPICalledEvent,
  context: MessageContext,
  includeAll: boolean
): void {
  const basicText = formatConsoleArgs(params.args);

  if (shouldExcludeConsoleMessage(basicText, params.type, includeAll)) {
    return;
  }

  if (hasArgsNeedingExpansion(params.args)) {
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
  cdp: CDPConnection,
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
 * Handle an exception thrown event.
 */
function handleExceptionThrown(
  messages: ConsoleMessage[],
  params: ExceptionThrownEvent,
  context: MessageContext,
  includeAll: boolean
): void {
  const exception = params.exceptionDetails;
  const text = exception.text ?? exception.exception?.description ?? 'Unknown error';

  if (shouldExcludeConsoleMessage(text, 'error', includeAll)) {
    return;
  }

  const message = createMessage('error', text, params.timestamp, undefined, context);
  insertMessageByTimestamp(messages, message);
}

/**
 * Start collecting console messages and exceptions via CDP Runtime domain.
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

  await cdp.send('Runtime.enable');

  registry.registerTyped(typed, 'Runtime.consoleAPICalled', (params) => {
    const context: MessageContext = {
      navigationId: getCurrentNavigationId?.(),
      stackTrace: convertStackTrace(params.stackTrace),
    };
    handleConsoleAPICall(cdp, messages, params, context, includeAll);
  });

  registry.registerTyped(typed, 'Runtime.exceptionThrown', (params) => {
    const context: MessageContext = {
      navigationId: getCurrentNavigationId?.(),
      stackTrace: convertStackTrace(params.exceptionDetails.stackTrace),
    };
    handleExceptionThrown(messages, params, context, includeAll);
  });

  return () => {
    registry.cleanup();
  };
}
