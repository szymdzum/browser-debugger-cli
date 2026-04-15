/**
 * Page scroll operations: scroll element into view, by pixel offset, or to
 * page boundaries.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { escapeSelectorForJS } from '@/runtime/dom/formFillHelpers/shared.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Scroll options.
 */
export interface ScrollOptions {
  down?: number;
  up?: number;
  left?: number;
  right?: number;
  top?: boolean;
  bottom?: boolean;
  index?: number;
}

/**
 * Scroll result.
 */
export interface ScrollResult {
  success: boolean;
  error?: string;
  suggestion?: string;
  exitCode?: number;
  scrollType: 'element' | 'position' | 'offset';
  selector?: string;
  scrolledTo?: { x: number; y: number };
  scrolledBy?: { x: number; y: number };
  viewportSize?: { width: number; height: number };
  pageSize?: { width: number; height: number };
}

const SCROLL_TO_ELEMENT_SCRIPT = `
(function(selector, index) {
  const allMatches = document.querySelectorAll(selector);
  if (allMatches.length === 0) {
    return { success: false, error: 'No nodes found matching selector: ' + selector };
  }

  let el;
  if (typeof index === 'number' && index >= 0) {
    if (index >= allMatches.length) {
      return {
        success: false,
        error: 'Index ' + index + ' out of range (found ' + allMatches.length + ' nodes, use 0-' + (allMatches.length - 1) + ')'
      };
    }
    el = allMatches[index];
  } else {
    el = allMatches[0];
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  const rect = el.getBoundingClientRect();
  const scrollX = window.scrollX + rect.left + rect.width / 2 - window.innerWidth / 2;
  const scrollY = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;

  return {
    success: true,
    scrollType: 'element',
    selector: selector,
    scrolledTo: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY)
    },
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    pageSize: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    }
  };
})`;

const SCROLL_BY_SCRIPT = `
(function(options) {
  const beforeX = window.scrollX;
  const beforeY = window.scrollY;

  if (options.top) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  } else if (options.bottom) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  } else {
    let deltaX = 0;
    let deltaY = 0;

    if (options.down) deltaY = options.down;
    if (options.up) deltaY = -options.up;
    if (options.right) deltaX = options.right;
    if (options.left) deltaX = -options.left;

    window.scrollBy({ left: deltaX, top: deltaY, behavior: 'instant' });
  }

  const afterX = window.scrollX;
  const afterY = window.scrollY;

  return {
    success: true,
    scrollType: options.top || options.bottom ? 'position' : 'offset',
    scrolledTo: { x: Math.round(afterX), y: Math.round(afterY) },
    scrolledBy: { x: Math.round(afterX - beforeX), y: Math.round(afterY - beforeY) },
    viewportSize: {
      width: window.innerWidth,
      height: window.innerHeight
    },
    pageSize: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    }
  };
})`;

function isScrollResult(value: unknown): value is ScrollResult {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['success'] === 'boolean' && typeof obj['scrollType'] === 'string';
}

/**
 * Scroll the page to an element, by offset, or to a boundary.
 */
export async function scrollPage(
  cdp: CDPConnection,
  selector: string | undefined,
  options: ScrollOptions = {}
): Promise<ScrollResult> {
  try {
    if (selector) {
      const indexArg = options.index ?? 'null';
      const expression = `(${SCROLL_TO_ELEMENT_SCRIPT})('${escapeSelectorForJS(selector)}', ${indexArg})`;

      const response = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });

      const cdpResponse = response as {
        exceptionDetails?: Protocol.Runtime.ExceptionDetails;
        result?: { value?: unknown };
      };

      if (cdpResponse.exceptionDetails) {
        return {
          success: false,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          scrollType: 'element',
          error: `Script execution failed: ${cdpResponse.exceptionDetails.text}`,
          suggestion: `Verify element exists: bdg dom query "${selector}"`,
        };
      }

      if (cdpResponse.result?.value && isScrollResult(cdpResponse.result.value)) {
        return cdpResponse.result.value;
      }

      const scriptResult = cdpResponse.result?.value as {
        success?: boolean;
        error?: string;
      };
      if (scriptResult?.success === false && scriptResult.error) {
        return {
          success: false,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          scrollType: 'element',
          error: scriptResult.error,
          suggestion: `Verify element exists: bdg dom query "${selector}"`,
        };
      }

      return {
        success: false,
        exitCode: EXIT_CODES.SOFTWARE_ERROR,
        scrollType: 'element',
        error: 'Unexpected response format',
      };
    }

    const scrollOptions = {
      down: options.down,
      up: options.up,
      left: options.left,
      right: options.right,
      top: options.top,
      bottom: options.bottom,
    };

    const expression = `(${SCROLL_BY_SCRIPT})(${JSON.stringify(scrollOptions)})`;

    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    });

    const cdpResponse = response as {
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
      result?: { value?: unknown };
    };

    if (cdpResponse.exceptionDetails) {
      return {
        success: false,
        exitCode: EXIT_CODES.SOFTWARE_ERROR,
        scrollType: 'offset',
        error: `Script execution failed: ${cdpResponse.exceptionDetails.text}`,
      };
    }

    if (cdpResponse.result?.value && isScrollResult(cdpResponse.result.value)) {
      return cdpResponse.result.value;
    }

    return {
      success: false,
      exitCode: EXIT_CODES.SOFTWARE_ERROR,
      scrollType: 'offset',
      error: 'Unexpected response format',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      exitCode: EXIT_CODES.SOFTWARE_ERROR,
      scrollType: selector ? 'element' : 'offset',
      error: `Scroll failed: ${errorMessage}`,
    };
  }
}
