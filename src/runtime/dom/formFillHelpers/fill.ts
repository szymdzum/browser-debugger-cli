/**
 * Fill and click operations — inject React-compatible page-context scripts
 * and unpack structured results.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  fillableElementNotFoundError,
  clickableElementNotFoundError,
  unexpectedResponseFormatError,
  operationFailedError,
} from '@/errors/messages.js';
import { inspectElementEventListenersBySelector } from '@/runtime/dom/eventListeners.js';
import {
  escapeSelectorForJS,
  escapeValueForJS,
  formatScriptExecutionError,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  REACT_FILL_SCRIPT,
  CLICK_ELEMENT_SCRIPT,
  isFillResult,
  isClickResult,
  type FillOptions,
  type FillResult,
  type ClickResult,
} from '@/runtime/dom/reactEventHelpers.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * Fill a form element with a value in a React-compatible way.
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
        'fill',
        expression
      );
      const err = fillableElementNotFoundError(selector);
      throw new CommandError(
        errorMessage,
        { suggestion: err.suggestion },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    if (cdpResponse.result?.value && isFillResult(cdpResponse.result.value)) {
      return await withEventListeners(cdp, selector, cdpResponse.result.value, options.index);
    }

    const err = unexpectedResponseFormatError('FillResult');
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = operationFailedError('fill element', errorMessage);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }
}

/**
 * Click an element.
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
        'click',
        expression
      );
      const err = clickableElementNotFoundError(selector);
      throw new CommandError(
        errorMessage,
        { suggestion: err.suggestion },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    if (cdpResponse.result?.value && isClickResult(cdpResponse.result.value)) {
      const result = await withEventListeners(
        cdp,
        selector,
        cdpResponse.result.value,
        options.index
      );
      if (result.eventListeners && hasClickLikeListeners(result.eventListeners.interactionTypes)) {
        return { ...result, clickable: true };
      }
      return result;
    }

    const err = unexpectedResponseFormatError('ClickResult');
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = operationFailedError('click element', errorMessage);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }
}

async function withEventListeners<T extends FillResult | ClickResult>(
  cdp: CDPConnection,
  selector: string,
  result: T,
  fallbackIndex: number | undefined
): Promise<T> {
  if (!result.success) {
    return result;
  }

  try {
    const index = result.selectedIndex ?? fallbackIndex ?? 0;
    const eventListeners = await inspectElementEventListenersBySelector(cdp, selector, index, {
      includeParent: true,
    });
    if (eventListeners === undefined) {
      return result;
    }

    return { ...result, eventListeners };
  } catch (error) {
    log.debug(`Unable to inspect event listeners for ${selector}: ${getErrorMessage(error)}`);
    return result;
  }
}

function hasClickLikeListeners(types: string[]): boolean {
  return types.some((type) =>
    [
      'click',
      'dblclick',
      'mousedown',
      'mouseup',
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
    ].includes(type)
  );
}
