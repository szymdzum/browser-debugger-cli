/**
 * Page scroll operations: scroll element into view, by pixel offset, or to
 * page boundaries.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import type { ScrollResult } from '@/ipc/protocol/domTypes.js';
import { VIEWPORT_SIZE_JS } from '@/runtime/dom/elementGeometry.js';
import { ELEMENT_IDENTITY_JS } from '@/runtime/dom/elementInfo.js';
import {
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import { FIND_ELEMENTS_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Scroll options.
 *
 * The reported viewport is the layout viewport without scrollbars and the
 * page size the scrolling element's, as in `bdg dom layout`.
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

export type { ScrollResult } from '@/ipc/protocol/domTypes.js';

const SCROLL_TO_ELEMENT_SCRIPT = `
(function(selector, parts, index) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector, parts);
  if (allMatches.length === 0) {
    return { success: false, error: 'No nodes found matching selector: ' + selector };
  }

  let el;
  if (typeof index === 'number' && index >= 0) {
    if (index >= allMatches.length) {
      return {
        success: false,
        reason: 'range',
        error: 'Index ' + index + ' out of range (found ' + allMatches.length + ' nodes, use 0-' + (allMatches.length - 1) + ')'
      };
    }
    el = allMatches[index];
  } else {
    el = allMatches[0];
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  return {
    success: true,
    scrollType: 'element',
    selector: selector,
    element: (${ELEMENT_IDENTITY_JS})(el),
    matchCount: allMatches.length,
    scrolledTo: {
      x: Math.round(window.scrollX),
      y: Math.round(window.scrollY)
    },
    viewportSize: (${VIEWPORT_SIZE_JS})(window),
    pageSize: {
      width: (document.scrollingElement || document.documentElement).scrollWidth,
      height: (document.scrollingElement || document.documentElement).scrollHeight
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
    viewportSize: (${VIEWPORT_SIZE_JS})(window),
    pageSize: {
      width: (document.scrollingElement || document.documentElement).scrollWidth,
      height: (document.scrollingElement || document.documentElement).scrollHeight
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
      const expression = `(${SCROLL_TO_ELEMENT_SCRIPT})(${selectorArgsJS(selector)}, ${indexArg})`;

      const response = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      });

      const cdpResponse = response as {
        exceptionDetails?: Protocol.Runtime.ExceptionDetails;
        result?: { value?: unknown };
      };

      if (cdpResponse.exceptionDetails) {
        throwIfInvalidSelector(cdpResponse.exceptionDetails, selector);
        return {
          success: false,
          exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
          scrollType: 'element',
          error: `Script execution failed: ${cdpResponse.exceptionDetails.text}`,
          suggestion: `Verify element exists: bdg dom query "${selector}"`,
        };
      }

      if (cdpResponse.result?.value && isScrollResult(cdpResponse.result.value)) {
        return withMultipleMatchesWarning(
          cdpResponse.result.value,
          options.index,
          'scrolled to the first'
        );
      }

      const scriptResult = cdpResponse.result?.value as {
        success?: boolean;
        error?: string;
        reason?: 'range';
      };
      if (scriptResult?.success === false && scriptResult.error) {
        const outOfRange = scriptResult.reason === 'range';
        return {
          success: false,
          exitCode: outOfRange ? EXIT_CODES.INVALID_ARGUMENTS : EXIT_CODES.RESOURCE_NOT_FOUND,
          scrollType: 'element',
          error: scriptResult.error,
          suggestion: `${outOfRange ? 'Check the matches' : 'Verify element exists'}: bdg dom query "${selector}"`,
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
    if (error instanceof CommandError) throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      exitCode: EXIT_CODES.SOFTWARE_ERROR,
      scrollType: selector ? 'element' : 'offset',
      error: `Scroll failed: ${errorMessage}`,
    };
  }
}
