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
  uploadDirectoryError,
  singleFileInputError,
  fillableElementNotFoundError,
  clickableElementNotFoundError,
  clickTargetDetachedError,
  unexpectedResponseFormatError,
  operationFailedError,
} from '@/errors/messages.js';
import {
  escapeValueForJS,
  formatScriptExecutionError,
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
  withValueMismatchWarning,
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
import { FIND_ELEMENTS_JS, LABEL_CONTROL_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  CLICK_NOT_RECEIVED_WARNING,
  POINTER_ACTION_DONE,
  domClickFallbackWarning,
} from '@/ui/messages/commands.js';
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

  const expression = `(${REACT_FILL_SCRIPT})(${selectorArgsJS(selector)}, '${escapeValueForJS(value)}', ${JSON.stringify(scriptOptions)})`;

  try {
    const response = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
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
      if (!result.fileInput) return withValueMismatchWarning(result);
      const uploaded = await setFileInput(cdp, selector, value, options);
      return uploaded.success && result.elementType
        ? { ...uploaded, elementType: result.elementType }
        : uploaded;
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

/** Empties a file input as a user removing the selection would (with events). */
const CLEAR_FILE_INPUT_FUNCTION = `function () {
  this.value = '';
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
}`;

/** Object group for remote objects created while selecting files. */
const UPLOAD_OBJECT_GROUP = 'bdg-upload';

/**
 * Resolve the files of a file-input value: one path (even with commas in its
 * name, when that file exists), several separated by commas, or none for "".
 *
 * @param value - Value given to `dom fill`
 * @param cwd - Directory relative paths are resolved against
 * @returns Absolute paths (empty clears the input)
 */
function uploadPaths(value: string, cwd: string): string[] {
  if (!value.trim()) return [];
  const whole = path.resolve(cwd, value.trim());
  if (fs.existsSync(whole)) return [whole];
  return value
    .split(',')
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => path.resolve(cwd, file));
}

/**
 * The first file that cannot be uploaded, as a failed fill result.
 *
 * @param files - Absolute paths
 * @returns Failure, or null when all are readable files
 */
function uploadProblem(files: string[]): FillResult | null {
  for (const file of files) {
    if (!fs.existsSync(file)) {
      const err = fileNotFoundError(file);
      return {
        success: false,
        error: err.message,
        suggestion: err.suggestion,
        exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
      };
    }
    if (fs.statSync(file).isDirectory()) {
      const err = uploadDirectoryError(file);
      return {
        success: false,
        error: err.message,
        suggestion: err.suggestion,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      };
    }
  }
  return null;
}

/**
 * Select files in a file input, as a user picking them in the file dialog.
 *
 * @param cdp - CDP connection
 * @param selector - Selector (or bound-node placeholder) of the file input
 * @param value - File path, several separated by commas, or "" to clear the input
 * @param options - Fill options (index, cwd for relative paths)
 * @returns Fill result
 */
async function setFileInput(
  cdp: CDPConnection,
  selector: string,
  value: string,
  options: FillOptions
): Promise<FillResult> {
  const files = uploadPaths(value, options.cwd ?? process.cwd());
  const problem = uploadProblem(files);
  if (problem) return problem;
  try {
    const located = (await cdp.send('Runtime.evaluate', {
      expression: `((el) => (${LABEL_CONTROL_JS})(el) || el)((${FIND_ELEMENTS_JS})(${selectorArgsJS(selector)})[${options.index ?? 0}])`,
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
    if (files.length > 0) await cdp.send('DOM.setFileInputFiles', { files, objectId });
    else {
      await cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: CLEAR_FILE_INPUT_FUNCTION,
      });
    }
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
    value: files.length > 0 ? files.map((file) => path.basename(file)).join(', ') : '(cleared)',
    elementType: 'input',
    inputType: 'file',
  };
}

/** How a located element is pointed at */
export type PointerAction = 'click' | 'double' | 'right' | 'hover';

/**
 * Page script doing an action on the located target with DOM events (when
 * the mouse cannot reach it); evaluates to false if the target is gone.
 *
 * @param action - What to do
 * @returns Script
 */
function domFallbackScript(action: PointerAction): string {
  const events: Record<PointerAction, string> = {
    click: 'el.click();',
    double: "el.click(); el.click(); el.dispatchEvent(new MouseEvent('dblclick', init));",
    right: "el.dispatchEvent(new MouseEvent('contextmenu', { ...init, button: 2 }));",
    hover:
      "['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach((type) => el.dispatchEvent(new MouseEvent(type, init)));",
  };
  return `(() => {
  const el = window.__bdgClickTarget;
  delete window.__bdgClickTarget;
  if (!el || !el.isConnected) return false;
  const init = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView };
  ${events[action]}
  return true;
})()`;
}

/**
 * Real mouse events for an action at a point.
 *
 * @param action - What to do
 * @param x - Page x
 * @param y - Page y
 * @returns `Input.dispatchMouseEvent` parameters, in order
 */
export function mouseEvents(
  action: PointerAction,
  x: number,
  y: number
): Array<Record<string, unknown>> {
  const moved = { type: 'mouseMoved', x, y };
  if (action === 'hover') return [moved];
  const button = action === 'right' ? 'right' : 'left';
  const press = (clickCount: number): Array<Record<string, unknown>> => [
    { type: 'mousePressed', x, y, button, clickCount },
    { type: 'mouseReleased', x, y, button, clickCount },
  ];
  return action === 'double' ? [moved, ...press(1), ...press(2)] : [moved, ...press(1)];
}

/**
 * Page script that stops the press probe installed by CLICK_ELEMENT_SCRIPT
 * and evaluates to whether the mouse press reached the target.
 */
const PRESS_PROBE_READ_SCRIPT = `(() => {
  const probe = window.__bdgPressProbe;
  delete window.__bdgPressProbe;
  if (!probe) return true;
  probe.stop();
  return probe.reached;
})()`;

/**
 * Whether the mouse press just dispatched reached the target element.
 *
 * Any doubt (no probe, evaluation failure) counts as reached, so only a
 * press that the page provably never saw is reported.
 *
 * @param cdp - CDP connection
 * @returns False only when the target received no pointerdown/mousedown
 */
export async function pressReachedTarget(cdp: CDPConnection): Promise<boolean> {
  try {
    const response = (await cdp.send('Runtime.evaluate', {
      expression: PRESS_PROBE_READ_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return response.result?.value !== false;
  } catch (error) {
    log.debug(`Press probe not read: ${getErrorMessage(error)}`);
    return true;
  }
}

/**
 * Dispatch real mouse events for an action, checking after the first press
 * that the target received it. If dispatching fails first, the press probe
 * is still removed from the page.
 *
 * @param cdp - CDP connection
 * @param action - What to do
 * @param x - Page x
 * @param y - Page y
 * @returns False if the press never reached the target
 */
async function dispatchMouseAction(
  cdp: CDPConnection,
  action: PointerAction,
  x: number,
  y: number
): Promise<boolean> {
  let reached: boolean | undefined;
  try {
    for (const event of mouseEvents(action, x, y)) {
      await cdp.send('Input.dispatchMouseEvent', event);
      if (event['type'] === 'mousePressed' && reached === undefined) {
        reached = await pressReachedTarget(cdp);
      }
    }
  } catch (error) {
    if (reached === undefined) await pressReachedTarget(cdp);
    throw error;
  }
  return reached ?? true;
}

/** Click target as located by CLICK_ELEMENT_SCRIPT. */
type LocatedClick = ClickResult & {
  x?: number;
  y?: number;
  hittable?: boolean;
  obstruction?: string | null;
};

/**
 * Drop the located element from the page without waiting: right after a
 * click on a link, evaluation waits until the new page commits (seconds for a
 * slow server), which `--no-wait` must not.
 *
 * @param cdp - CDP connection
 */
function releaseClickTarget(cdp: CDPConnection): void {
  void cdp
    .send('Runtime.evaluate', { expression: 'delete window.__bdgClickTarget' })
    .catch((error: unknown) => log.debug(`Click target not released: ${getErrorMessage(error)}`));
}

/**
 * Click a located element.
 *
 * Uses real mouse events (pointerdown/mousedown/pointerup/mouseup/click, all
 * trusted) at the element's center when it is the topmost element there, so
 * components that react to pointer or mouse events (menus, selects) respond.
 * Otherwise (covered or zero-size) falls back to `el.click()` and says so.
 * Double and right clicks, and hovering, work the same way.
 *
 * @param cdp - CDP connection
 * @param located - Locate result with center point
 * @param action - Click, double click, right click or hover
 * @returns Click result
 */
async function performClick(
  cdp: CDPConnection,
  located: LocatedClick,
  action: PointerAction
): Promise<ClickResult> {
  const { x, y, hittable, obstruction, ...result } = located;
  if (!result.success) return result;

  if (hittable && x !== undefined && y !== undefined) {
    const reached = await dispatchMouseAction(cdp, action, x, y);
    releaseClickTarget(cdp);
    return withMultipleMatchesWarning<ClickResult>(
      {
        ...result,
        action,
        method: 'mouse',
        ...(!reached && { warning: CLICK_NOT_RECEIVED_WARNING }),
      },
      result.selectedIndex,
      `${POINTER_ACTION_DONE[action].toLowerCase()} the first visible one`
    );
  }

  const response = (await cdp.send('Runtime.evaluate', {
    expression: domFallbackScript(action),
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
  return withMultipleMatchesWarning<ClickResult>(
    { ...result, action, method: 'dom', warning: domClickFallbackWarning(obstruction) },
    result.selectedIndex,
    `${POINTER_ACTION_DONE[action].toLowerCase()} the first visible one`
  );
}

/**
 * Click an element.
 */
export async function clickElement(
  cdp: CDPConnection,
  selector: string,
  options: { index?: number; action?: PointerAction } = {}
): Promise<ClickResult> {
  const indexArg = options.index ?? 'null';
  const action = options.action ?? 'click';
  const expression = `(${CLICK_ELEMENT_SCRIPT})(${selectorArgsJS(selector)}, ${indexArg}, '${action}')`;

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
      return await performClick(cdp, cdpResponse.result.value, action);
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
