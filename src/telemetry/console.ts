import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { ConsoleMessage, CleanupFunction, StackFrame } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

import { shouldExcludeConsoleMessage } from './filters.js';
import { formatConsoleArgs } from './remoteObject.js';
import { pushWithLimit } from './utils.js';

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

  return stackTrace.callFrames.map((frame) => {
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
  });
}

const log = createLogger('console');

/**
 * Start collecting console messages and exceptions via CDP Runtime domain.
 *
 * Captures console.log, console.error, etc. and JavaScript exceptions thrown in the page.
 *
 * @param cdp - CDP connection instance
 * @param messages - Array to populate with console messages
 * @param includeAll - If true, disable default pattern filtering (default: false)
 * @returns Cleanup function to remove event handlers
 *
 * @remarks
 * - Message limit of 10,000 prevents memory issues in long-running sessions
 * - After limit is reached, new messages are silently dropped (warning logged once)
 * - By default, common dev server noise patterns are filtered out (use includeAll to disable)
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
    const text = formatConsoleArgs(params.args);

    if (shouldExcludeConsoleMessage(text, params.type, includeAll)) {
      return;
    }

    const navigationId = getCurrentNavigationId?.();
    const stackTrace = convertStackTrace(params.stackTrace);
    const message: ConsoleMessage = {
      type: params.type,
      text,
      timestamp: params.timestamp,
      args: params.args,
      ...(navigationId !== undefined && { navigationId }),
      ...(stackTrace && { stackTrace }),
    };
    pushWithLimit(messages, message, MAX_CONSOLE_MESSAGES, () => {
      log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
    });
  });

  registry.registerTyped(typed, 'Runtime.exceptionThrown', (params) => {
    const exception = params.exceptionDetails;
    const text = exception.text ?? exception.exception?.description ?? 'Unknown error';

    if (shouldExcludeConsoleMessage(text, 'error', includeAll)) {
      return;
    }

    const navigationId = getCurrentNavigationId?.();
    const stackTrace = convertStackTrace(exception.stackTrace);
    const message: ConsoleMessage = {
      type: 'error',
      text,
      timestamp: params.timestamp,
      ...(navigationId !== undefined && { navigationId }),
      ...(stackTrace && { stackTrace }),
    };
    pushWithLimit(messages, message, MAX_CONSOLE_MESSAGES, () => {
      log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
    });
  });

  return () => {
    registry.cleanup();
  };
}
