import type { CDPConnection } from '@/connection/cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants';
import type {
  ConsoleMessage,
  CleanupFunction,
  CDPConsoleAPICalledParams,
  CDPExceptionThrownParams,
} from '@/types';
import { shouldExcludeConsoleMessage } from '@/utils/filters.js';

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
  includeAll: boolean = false
): Promise<CleanupFunction> {
  const handlers: Array<{ event: string; id: number }> = [];

  // Enable runtime
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // Listen for console API calls
  const consoleAPIId = cdp.on('Runtime.consoleAPICalled', (params: CDPConsoleAPICalledParams) => {
    const text = params.args
      .map((arg) => {
        // arg type already defined in CDPConsoleAPICalledParams
        if (arg.value !== undefined) {
          // Handle different value types - primitives only, objects use description
          const value = arg.value;
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            return String(value);
          }
          // For objects/arrays, use description if available
          return arg.description ?? '[object]';
        }
        if (arg.description !== undefined) {
          return arg.description;
        }
        return '';
      })
      .join(' ');

    // Apply pattern filtering
    if (shouldExcludeConsoleMessage(text, includeAll)) {
      return;
    }

    const message: ConsoleMessage = {
      type: params.type,
      text,
      timestamp: params.timestamp,
      args: params.args,
    };
    if (messages.length < MAX_CONSOLE_MESSAGES) {
      messages.push(message);
    } else if (messages.length === MAX_CONSOLE_MESSAGES) {
      console.error(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
    }
  });
  handlers.push({ event: 'Runtime.consoleAPICalled', id: consoleAPIId });

  // Listen for exceptions
  const exceptionId = cdp.on('Runtime.exceptionThrown', (params: CDPExceptionThrownParams) => {
    const exception = params.exceptionDetails;
    const text = exception.text ?? exception.exception?.description ?? 'Unknown error';

    // Apply pattern filtering (but don't filter errors by default)
    // Errors are usually important, only filter if they match noise patterns
    if (shouldExcludeConsoleMessage(text, includeAll)) {
      return;
    }

    const message: ConsoleMessage = {
      type: 'error',
      text,
      timestamp: exception.timestamp ?? Date.now(),
    };
    if (messages.length < MAX_CONSOLE_MESSAGES) {
      messages.push(message);
    }
  });
  handlers.push({ event: 'Runtime.exceptionThrown', id: exceptionId });

  // Return cleanup function
  return () => {
    // Remove event handlers
    handlers.forEach(({ event, id }) => cdp.off(event, id));
  };
}
