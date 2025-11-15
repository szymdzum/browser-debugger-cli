/**
 * Form interaction helpers for filling inputs, clicking buttons, etc.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import {
  REACT_FILL_SCRIPT,
  CLICK_ELEMENT_SCRIPT,
  GET_ELEMENT_BY_INDEX_SCRIPT,
  type FillOptions,
  type FillResult,
  type ClickResult,
  type ElementByIndexResult,
} from './reactEventHelpers.js';

/**
 * Fill a form element with a value in a React-compatible way.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector for the element
 * @param value - Value to fill
 * @param options - Fill options
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
  let targetSelector = selector;

  // If index is specified, resolve it to a unique selector first
  if (options.index !== undefined) {
    const indexResult = await getElementByIndex(cdp, selector, options.index);
    if (!indexResult.success) {
      return indexResult as FillResult;
    }
    if (!indexResult.uniqueSelector) {
      throw new CommandError(
        'Failed to resolve unique selector for element index',
        { note: 'Element index resolution returned no unique selector' },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }
    targetSelector = indexResult.uniqueSelector;
  }

  // Execute the fill script
  const expression = `(${REACT_FILL_SCRIPT})('${escapeSelectorForJS(targetSelector)}', '${escapeValueForJS(value)}', ${JSON.stringify({ blur: options.blur ?? true })})`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true, // Treat as user-initiated action
    });

    // Type guard for CDP response
    const cdpResponse = response as {
      exceptionDetails?: { text?: string };
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      throw new CommandError(
        'Script execution failed',
        { note: cdpResponse.exceptionDetails.text ?? 'Unknown error' },
        EXIT_CODES.SOFTWARE_ERROR
      );
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
 * @param options - Click options
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
  let targetSelector = selector;

  // If index is specified, resolve it to a unique selector first
  if (options.index !== undefined) {
    const indexResult = await getElementByIndex(cdp, selector, options.index);
    if (!indexResult.success) {
      return indexResult as ClickResult;
    }
    if (!indexResult.uniqueSelector) {
      throw new CommandError(
        'Failed to resolve unique selector for element index',
        { note: 'Element index resolution returned no unique selector' },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }
    targetSelector = indexResult.uniqueSelector;
  }

  // Execute the click script
  const expression = `(${CLICK_ELEMENT_SCRIPT})('${escapeSelectorForJS(targetSelector)}')`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true,
    });

    const cdpResponse = response as {
      exceptionDetails?: { text?: string };
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      throw new CommandError(
        'Script execution failed',
        { note: cdpResponse.exceptionDetails.text ?? 'Unknown error' },
        EXIT_CODES.SOFTWARE_ERROR
      );
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
 * Get element by index when selector matches multiple elements.
 *
 * @param cdp - CDP connection
 * @param selector - CSS selector
 * @param index - Element index (1-based)
 * @returns Promise resolving to element info
 *
 * @throws CommandError When element operations fail
 *
 * @internal
 */
async function getElementByIndex(
  cdp: CDPConnection,
  selector: string,
  index: number
): Promise<ElementByIndexResult> {
  const expression = `(${GET_ELEMENT_BY_INDEX_SCRIPT})('${escapeSelectorForJS(selector)}', ${index})`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    const cdpResponse = response as {
      exceptionDetails?: { text?: string };
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      throw new CommandError(
        'Script execution failed',
        { note: cdpResponse.exceptionDetails.text ?? 'Unknown error' },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    if (cdpResponse.result?.value) {
      return cdpResponse.result.value as ElementByIndexResult;
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
      'Failed to get element by index',
      { note: errorMessage },
      EXIT_CODES.SOFTWARE_ERROR
    );
  }
}

/**
 * Escape CSS selector for safe inclusion in JavaScript string.
 * Uses JSON.stringify to handle all special characters safely.
 *
 * @param selector - CSS selector to escape
 * @returns Escaped selector (without surrounding quotes)
 *
 * @internal
 */
function escapeSelectorForJS(selector: string): string {
  // JSON.stringify handles all escaping (backslashes, quotes, newlines, control chars)
  // Remove surrounding quotes since we add them in the template
  return JSON.stringify(selector).slice(1, -1);
}

/**
 * Escape value for safe inclusion in JavaScript string.
 * Uses JSON.stringify to handle all special characters safely.
 *
 * @param value - Value to escape
 * @returns Escaped value (without surrounding quotes)
 *
 * @internal
 */
function escapeValueForJS(value: string): string {
  // JSON.stringify handles all escaping (backslashes, quotes, newlines, control chars)
  // Remove surrounding quotes since we add them in the template
  return JSON.stringify(value).slice(1, -1);
}
