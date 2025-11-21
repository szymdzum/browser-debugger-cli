/**
 * Form interaction helpers for filling inputs, clicking buttons, etc.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { getKeyDefinition, parseModifiers, type KeyDefinition } from './keyMapping.js';
import {
  REACT_FILL_SCRIPT,
  CLICK_ELEMENT_SCRIPT,
  type FillOptions,
  type FillResult,
  type ClickResult,
} from './reactEventHelpers.js';

const log = createLogger('dom');

/** Network idle threshold for post-action stability (ms) */
const ACTION_NETWORK_IDLE_MS = 150;
/** Maximum time to wait for post-action stability (ms) */
const ACTION_STABILITY_TIMEOUT_MS = 2000;
/** Check interval for stability polling (ms) */
const STABILITY_CHECK_INTERVAL_MS = 50;

/**
 * Format exception details into a user-friendly error message with troubleshooting hints.
 *
 * @param exceptionDetails - CDP exception details
 * @param selector - CSS selector that was used
 * @param operationType - Type of operation (fill or click) for tailored hints
 * @returns Formatted error message with context
 */
function formatScriptExecutionError(
  exceptionDetails: Protocol.Runtime.ExceptionDetails,
  selector: string,
  operationType: 'fill' | 'click' = 'fill'
): string {
  const errorText = exceptionDetails.text || 'Unknown error';
  const location =
    exceptionDetails.lineNumber !== undefined && exceptionDetails.columnNumber !== undefined
      ? ` at line ${exceptionDetails.lineNumber + 1}, column ${exceptionDetails.columnNumber + 1}`
      : '';

  const troubleshootingSteps =
    operationType === 'fill'
      ? [
          `1. Verify element exists: bdg dom query "${selector}"`,
          '2. Check element is visible and not disabled',
          `3. Try direct eval: bdg dom eval "document.querySelector('${escapeSelectorForJS(selector)}').value = 'your-value'"`,
        ]
      : [
          `1. Verify element exists: bdg dom query "${selector}"`,
          '2. Check element is visible and clickable',
          `3. Try direct eval: bdg dom eval "document.querySelector('${escapeSelectorForJS(selector)}').click()"`,
        ];

  return `Script execution failed: ${errorText}${location}\n\nTroubleshooting:\n  ${troubleshootingSteps.join('\n  ')}`;
}

/**
 * Fill a form element with a value in a React-compatible way.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector for the element
 * @param value - Value to fill
 * @param options - Fill options including optional index for multiple matches
 * @returns Promise resolving to fill result
 *
 * @throws CommandError When element operations fail
 *
 * @example
 * ```typescript
 * const result = await fillElement(cdp, 'input[name="email"]', 'test@example.com');
 * if (result.success) {
 *   console.log(`Filled ${result.elementType} with value: ${result.value}`);
 * }
 * ```
 */
export async function fillElement(
  cdp: CDPConnection,
  selector: string,
  value: string,
  options: FillOptions = {}
): Promise<FillResult> {
  const scriptOptions = {
    blur: options.blur ?? true,
    index: options.index,
  };

  const expression = `(${REACT_FILL_SCRIPT})('${escapeSelectorForJS(selector)}', '${escapeValueForJS(value)}', ${JSON.stringify(scriptOptions)})`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true, // Treat as user-initiated action
    });

    const cdpResponse = response as {
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      const errorMessage = formatScriptExecutionError(
        cdpResponse.exceptionDetails,
        selector,
        'fill'
      );
      throw new CommandError(errorMessage, {}, EXIT_CODES.SOFTWARE_ERROR);
    }

    if (cdpResponse.result?.value) {
      return cdpResponse.result.value as FillResult;
    }

    throw new CommandError(
      'Unexpected response format',
      { note: 'CDP response missing result.value' },
      EXIT_CODES.SOFTWARE_ERROR
    );
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new CommandError(
      'Failed to fill element',
      { note: errorMessage },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }
}

/**
 * Click an element.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector for the element
 * @param options - Click options including optional index for multiple matches
 * @returns Promise resolving to click result
 *
 * @throws CommandError When element operations fail
 *
 * @example
 * ```typescript
 * const result = await clickElement(cdp, 'button[type="submit"]');
 * if (result.success) {
 *   console.log(`Clicked ${result.elementType}`);
 * }
 * ```
 */
export async function clickElement(
  cdp: CDPConnection,
  selector: string,
  options: { index?: number } = {}
): Promise<ClickResult> {
  const indexArg = options.index ?? 'null';
  const expression = `(${CLICK_ELEMENT_SCRIPT})('${escapeSelectorForJS(selector)}', ${indexArg})`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    });

    const cdpResponse = response as {
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      const errorMessage = formatScriptExecutionError(
        cdpResponse.exceptionDetails,
        selector,
        'click'
      );
      throw new CommandError(errorMessage, {}, EXIT_CODES.SOFTWARE_ERROR);
    }

    if (cdpResponse.result?.value) {
      return cdpResponse.result.value as ClickResult;
    }

    throw new CommandError(
      'Unexpected response format',
      { note: 'CDP response missing result.value' },
      EXIT_CODES.SOFTWARE_ERROR
    );
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new CommandError(
      'Failed to click element',
      { note: errorMessage },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }
}

/**
 * Escape CSS selector for safe inclusion in JavaScript single-quoted string.
 * Uses JSON.stringify for special characters, then escapes single quotes
 * since the expression wrapper uses single quotes.
 *
 * @param selector - CSS selector to escape
 * @returns Escaped selector safe for single-quoted JS string
 *
 * @internal
 */
function escapeSelectorForJS(selector: string): string {
  return JSON.stringify(selector).slice(1, -1).replace(/'/g, "\\'");
}

/**
 * Escape value for safe inclusion in JavaScript single-quoted string.
 * Uses JSON.stringify for special characters, then escapes single quotes
 * since the expression wrapper uses single quotes.
 *
 * @param value - Value to escape
 * @returns Escaped value safe for single-quoted JS string
 *
 * @internal
 */
function escapeValueForJS(value: string): string {
  return JSON.stringify(value).slice(1, -1).replace(/'/g, "\\'");
}

/**
 * Wait for page to stabilize after an action (click, fill, etc.).
 *
 * This is a lightweight stability check designed for post-action waiting:
 * - Waits for network to be idle for 150ms
 * - Times out after 2s to avoid hanging
 * - Does not block on slow background requests
 *
 * @param cdp - CDP connection
 * @returns Promise that resolves when stable or timeout reached
 *
 * @remarks
 * This is intentionally less strict than page readiness on initial load.
 * It's designed to catch immediate reactions to user actions (AJAX, re-renders)
 * without waiting for unrelated background activity.
 */
export async function waitForActionStability(cdp: CDPConnection): Promise<void> {
  const deadline = Date.now() + ACTION_STABILITY_TIMEOUT_MS;

  let activeRequests = 0;
  let lastActivity = Date.now();

  const requestHandler = (): void => {
    activeRequests++;
    lastActivity = Date.now();
  };

  const finishHandler = (): void => {
    activeRequests--;
    if (activeRequests === 0) {
      lastActivity = Date.now();
    }
  };

  await cdp.send('Network.enable');

  const cleanupRequest = cdp.on('Network.requestWillBeSent', requestHandler);
  const cleanupFinished = cdp.on('Network.loadingFinished', finishHandler);
  const cleanupFailed = cdp.on('Network.loadingFailed', finishHandler);

  try {
    while (Date.now() < deadline) {
      if (activeRequests === 0) {
        const idleTime = Date.now() - lastActivity;
        if (idleTime >= ACTION_NETWORK_IDLE_MS) {
          log.debug(`Network stable after ${idleTime}ms idle`);
          return;
        }
      }

      await delay(STABILITY_CHECK_INTERVAL_MS);
    }

    log.debug('Stability timeout reached, proceeding');
  } finally {
    cleanupRequest();
    cleanupFinished();
    cleanupFailed();
  }
}

/**
 * Delay utility.
 *
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Options for pressing a key on an element.
 */
export interface PressKeyOptions {
  /** Element index if selector matches multiple (1-based) */
  index?: number;
  /** Number of times to press the key (default: 1) */
  times?: number;
  /** Comma-separated modifier keys (shift, ctrl, alt, meta) */
  modifiers?: string;
}

/**
 * Result of pressing a key.
 */
export interface PressKeyResult {
  success: boolean;
  error?: string;
  selector?: string;
  key?: string;
  times?: number;
  modifiers?: number;
  elementType?: string | undefined;
}

/**
 * Script to focus an element by selector and optional index.
 *
 * @returns Object with success status and element info
 */
const FOCUS_ELEMENT_SCRIPT = `
(function(selector, index) {
  const allMatches = document.querySelectorAll(selector);
  if (allMatches.length === 0) {
    return { success: false, error: 'No elements found matching selector: ' + selector };
  }

  let el;
  if (typeof index === 'number' && index > 0) {
    if (index > allMatches.length) {
      return { 
        success: false, 
        error: 'Index ' + index + ' out of range (found ' + allMatches.length + ' elements)' 
      };
    }
    el = allMatches[index - 1];
  } else {
    el = allMatches[0];
  }

  el.focus();
  
  return {
    success: true,
    selector: selector,
    elementType: el.tagName.toLowerCase(),
    focused: document.activeElement === el
  };
})`;

/**
 * Press a key on an element.
 *
 * Focuses the element first, then dispatches keyDown and keyUp events via CDP.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector for the element
 * @param keyName - Key name (e.g., "Enter", "Tab", "a")
 * @param options - Press key options
 * @returns Promise resolving to press key result
 *
 * @throws CommandError When element or key operations fail
 *
 * @example
 * ```typescript
 * // Press Enter on a todo input
 * const result = await pressKeyElement(cdp, '.new-todo', 'Enter');
 *
 * // Press Tab 3 times with Shift held
 * const result = await pressKeyElement(cdp, 'input', 'Tab', {
 *   times: 3,
 *   modifiers: 'shift'
 * });
 * ```
 */
export async function pressKeyElement(
  cdp: CDPConnection,
  selector: string,
  keyName: string,
  options: PressKeyOptions = {}
): Promise<PressKeyResult> {
  const keyDef = getKeyDefinition(keyName);
  if (!keyDef) {
    return {
      success: false,
      error: `Unknown key: "${keyName}". Supported keys: Enter, Tab, Escape, Space, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12, a-z, 0-9`,
    };
  }

  const times = options.times ?? 1;
  const modifierFlags = parseModifiers(options.modifiers);
  const indexArg = options.index ?? 'null';
  const focusExpression = `(${FOCUS_ELEMENT_SCRIPT})('${escapeSelectorForJS(selector)}', ${indexArg})`;

  try {
    const focusResponse = await cdp.send('Runtime.evaluate', {
      expression: focusExpression,
      returnByValue: true,
    });

    const focusCdpResponse = focusResponse as {
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
      result?: { value?: unknown };
    };

    if (focusCdpResponse.exceptionDetails) {
      throw new CommandError(
        `Failed to focus element: ${focusCdpResponse.exceptionDetails.text}`,
        { note: `Selector: ${selector}` },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    const focusResult = focusCdpResponse.result?.value as {
      success: boolean;
      error?: string;
      elementType?: string;
    };

    if (!focusResult?.success) {
      return {
        success: false,
        error: focusResult?.error ?? 'Failed to focus element',
        selector,
      };
    }

    for (let i = 0; i < times; i++) {
      await dispatchKeyEvent(cdp, 'keyDown', keyDef, modifierFlags);
      await dispatchKeyEvent(cdp, 'keyUp', keyDef, modifierFlags);
    }

    return {
      success: true,
      selector,
      key: keyName,
      times,
      modifiers: modifierFlags,
      elementType: focusResult.elementType,
    };
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new CommandError(
      'Failed to press key',
      { note: errorMessage },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }
}

/**
 * Dispatch a single key event via CDP Input.dispatchKeyEvent.
 *
 * @param cdp - CDP connection
 * @param type - Event type (keyDown or keyUp)
 * @param keyDef - Key definition with code, key, and keyCode
 * @param modifiers - Modifier bit flags
 */
async function dispatchKeyEvent(
  cdp: CDPConnection,
  type: 'keyDown' | 'keyUp',
  keyDef: KeyDefinition,
  modifiers: number
): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    code: keyDef.code,
    key: keyDef.key,
    windowsVirtualKeyCode: keyDef.keyCode,
    nativeVirtualKeyCode: keyDef.keyCode,
    modifiers,
  });
}
