/**
 * Fill and click operations — inject React-compatible page-context scripts
 * and unpack structured results.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  fileNotFoundError,
  singleFileInputError,
  fillableElementNotFoundError,
  clickableElementNotFoundError,
  clickTargetDetachedError,
  unexpectedResponseFormatError,
  operationFailedError,
} from '@/errors/messages.js';
import {
  escapeSelectorForJS,
  escapeValueForJS,
  formatScriptExecutionError,
  throwIfInvalidSelector,
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
import { FIND_ELEMENTS_JS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import { domClickFallbackWarning } from '@/ui/messages/commands.js';
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
      throwIfInvalidSelector(cdpResponse.exceptionDetails, selector);
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
      const result = cdpResponse.result.value;
      return result.fileInput ? await setFileInput(cdp, selector, value, options) : result;
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

/** Object group for remote objects created while selecting files. */
const UPLOAD_OBJECT_GROUP = 'bdg-upload';

/**
 * Select files in a file input, as a user picking them in the file dialog.
 *
 * @param cdp - CDP connection
 * @param selector - Selector (or bound-node placeholder) of the file input
 * @param value - File path, or several separated by commas
 * @param options - Fill options (index, cwd for relative paths)
 * @returns Fill result
 */
async function setFileInput(
  cdp: CDPConnection,
  selector: string,
  value: string,
  options: FillOptions
): Promise<FillResult> {
  const files = value
    .split(',')
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => path.resolve(options.cwd ?? process.cwd(), file));
  const missing = files.find((file) => !fs.existsSync(file));
  if (missing !== undefined || files.length === 0) {
    const err = fileNotFoundError(missing ?? value);
    return {
      success: false,
      error: err.message,
      suggestion: err.suggestion,
      exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
    };
  }
  try {
    const located = (await cdp.send('Runtime.evaluate', {
      expression: `(${FIND_ELEMENTS_JS})('${escapeSelectorForJS(selector)}')[${options.index ?? 0}]`,
      objectGroup: UPLOAD_OBJECT_GROUP,
    })) as { result?: { objectId?: string }; exceptionDetails?: Protocol.Runtime.ExceptionDetails };
    if (located.exceptionDetails) throwIfInvalidSelector(located.exceptionDetails, selector);
    const objectId = located.result?.objectId;
    if (!objectId) {
      const err = fillableElementNotFoundError(selector);
      return { success: false, error: err.message, suggestion: err.suggestion };
    }
    const multiple = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this.multiple; }',
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    if (files.length > 1 && multiple.result?.value !== true) {
      const err = singleFileInputError(files.length);
      return {
        success: false,
        error: err.message,
        suggestion: err.suggestion,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      };
    }
    await cdp.send('DOM.setFileInputFiles', { files, objectId });
  } finally {
    await cdp
      .send('Runtime.releaseObjectGroup', { objectGroup: UPLOAD_OBJECT_GROUP })
      .catch((error: unknown) =>
        log.debug(`Could not release upload objects: ${getErrorMessage(error)}`)
      );
  }
  return {
    success: true,
    selector,
    value: files.map((file) => path.basename(file)).join(', '),
    elementType: 'input',
    inputType: 'file',
  };
}

/** Clicks the located target with `el.click()`; returns false if it is gone. */
const DOM_CLICK_FALLBACK_SCRIPT = `(() => {
  const el = window.__bdgClickTarget;
  delete window.__bdgClickTarget;
  if (!el || !el.isConnected) return false;
  el.click();
  return true;
})()`;

/** Click target as located by CLICK_ELEMENT_SCRIPT. */
type LocatedClick = ClickResult & {
  x?: number;
  y?: number;
  hittable?: boolean;
  obstruction?: string | null;
};

/**
 * Click a located element.
 *
 * Uses real mouse events (pointerdown/mousedown/pointerup/mouseup/click, all
 * trusted) at the element's center when it is the topmost element there, so
 * components that react to pointer or mouse events (menus, selects) respond.
 * Otherwise (covered or zero-size) falls back to `el.click()` and says so.
 *
 * @param cdp - CDP connection
 * @param located - Locate result with center point
 * @returns Click result
 */
async function performClick(cdp: CDPConnection, located: LocatedClick): Promise<ClickResult> {
  const { x, y, hittable, obstruction, ...result } = located;
  if (!result.success) return result;

  if (hittable && x !== undefined && y !== undefined) {
    const mouse = { x, y, button: 'left' as const, clickCount: 1 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
    await cdp.send('Runtime.evaluate', { expression: 'delete window.__bdgClickTarget' });
    return { ...result, method: 'mouse' };
  }

  const response = (await cdp.send('Runtime.evaluate', {
    expression: DOM_CLICK_FALLBACK_SCRIPT,
    returnByValue: true,
    userGesture: true,
  })) as { result?: { value?: unknown } };
  if (response.result?.value !== true) {
    const err = clickTargetDetachedError(result.selector ?? '');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return { ...result, method: 'dom', warning: domClickFallbackWarning(obstruction) };
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
      throwIfInvalidSelector(cdpResponse.exceptionDetails, selector);
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
      return await performClick(cdp, cdpResponse.result.value);
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
