import { CDPConnection } from '../connection/cdp.js';
import {
  ConsoleMessage,
  CleanupFunction,
  CDPConsoleAPICalledParams,
  CDPExceptionThrownParams
} from '../types.js';

const MAX_MESSAGES = 10000; // Prevent memory issues

/**
 * Start collecting console messages and exceptions via CDP Runtime domain.
 *
 * Captures console.log, console.error, etc. and JavaScript exceptions thrown in the page.
 *
 * @param cdp - CDP connection instance
 * @param messages - Array to populate with console messages
 * @returns Cleanup function to remove event handlers
 *
 * @remarks
 * - Message limit of 10,000 prevents memory issues in long-running sessions
 * - After limit is reached, new messages are silently dropped (warning logged once)
 */
export async function startConsoleCollection(
  cdp: CDPConnection,
  messages: ConsoleMessage[]
): Promise<CleanupFunction> {
  const handlers: Array<{ event: string; id: number }> = [];

  // Enable runtime
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // Listen for console API calls
  const consoleAPIId = cdp.on('Runtime.consoleAPICalled', (params: CDPConsoleAPICalledParams) => {
    const message: ConsoleMessage = {
      type: params.type,
      text: params.args
        .map((arg: any) => {
          if (arg.value !== undefined) {
            return String(arg.value);
          }
          if (arg.description !== undefined) {
            return arg.description;
          }
          return '';
        })
        .join(' '),
      timestamp: params.timestamp,
      args: params.args
    };
    if (messages.length < MAX_MESSAGES) {
      messages.push(message);
    } else if (messages.length === MAX_MESSAGES) {
      console.error(`Warning: Console message limit reached (${MAX_MESSAGES})`);
    }
  });
  handlers.push({ event: 'Runtime.consoleAPICalled', id: consoleAPIId });

  // Listen for exceptions
  const exceptionId = cdp.on('Runtime.exceptionThrown', (params: CDPExceptionThrownParams) => {
    const exception = params.exceptionDetails;
    const message: ConsoleMessage = {
      type: 'error',
      text: exception.text || exception.exception?.description || 'Unknown error',
      timestamp: exception.timestamp || Date.now()
    };
    if (messages.length < MAX_MESSAGES) {
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
