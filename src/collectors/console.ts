import { CDPConnection } from '../connection/cdp.js';
import { ConsoleMessage, CleanupFunction } from '../types.js';

const MAX_MESSAGES = 10000; // Prevent memory issues

export async function startConsoleCollection(
  cdp: CDPConnection,
  messages: ConsoleMessage[]
): Promise<CleanupFunction> {
  const handlerIds: number[] = [];

  // Enable runtime
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // Listen for console API calls
  const consoleAPIId = cdp.on('Runtime.consoleAPICalled', (params: any) => {
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
  handlerIds.push(consoleAPIId);

  // Listen for exceptions
  const exceptionId = cdp.on('Runtime.exceptionThrown', (params: any) => {
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
  handlerIds.push(exceptionId);

  // Return cleanup function
  return () => {
    // Remove event handlers
    handlerIds.forEach(id => cdp.off('Runtime.consoleAPICalled', id));
    handlerIds.forEach(id => cdp.off('Runtime.exceptionThrown', id));
  };
}
