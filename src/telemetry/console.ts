import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { ConsoleMessage, CleanupFunction } from '@/types';
import { createLogger } from '@/ui/logging/index.js';

import { shouldExcludeConsoleMessage } from './filters.js';
import { pushWithLimit } from './utils.js';

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

  // Enable runtime
  await cdp.send('Runtime.enable');

  // Listen for console API calls
  registry.register<Protocol.Runtime.ConsoleAPICalledEvent>(
    cdp,
    'Runtime.consoleAPICalled',
    (params: Protocol.Runtime.ConsoleAPICalledEvent) => {
      const text = params.args
        .map((arg) => {
          // arg type already defined in Protocol.Runtime.ConsoleAPICalledEvent
          if (arg.value !== undefined) {
            // Handle different value types - primitives only, objects use description
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      if (shouldExcludeConsoleMessage(text, params.type, includeAll)) {
        return;
      }

      const navigationId = getCurrentNavigationId?.();
      const message: ConsoleMessage = {
        type: params.type,
        text,
        timestamp: params.timestamp,
        args: params.args,
        ...(navigationId !== undefined && { navigationId }),
      };
      pushWithLimit(messages, message, MAX_CONSOLE_MESSAGES, () => {
        log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
      });
    }
  );

  // Listen for exceptions
  registry.register<Protocol.Runtime.ExceptionThrownEvent>(
    cdp,
    'Runtime.exceptionThrown',
    (params: Protocol.Runtime.ExceptionThrownEvent) => {
      const exception = params.exceptionDetails;
      const text = exception.text ?? exception.exception?.description ?? 'Unknown error';

      // Apply pattern filtering (but don't filter errors by default)
      // Errors are usually important, only filter if they match noise patterns
      if (shouldExcludeConsoleMessage(text, 'error', includeAll)) {
        return;
      }

      const navigationId = getCurrentNavigationId?.();
      const message: ConsoleMessage = {
        type: 'error',
        text,
        timestamp: params.timestamp,
        ...(navigationId !== undefined && { navigationId }),
      };
      pushWithLimit(messages, message, MAX_CONSOLE_MESSAGES, () => {
        log.debug(`Warning: Console message limit reached (${MAX_CONSOLE_MESSAGES})`);
      });
    }
  );

  // Return cleanup function
  return () => {
    // Remove event handlers
    registry.cleanup(cdp);
  };
}
