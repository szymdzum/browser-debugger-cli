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
  pressNotReceivedError,
  unreachableElementError,
} from '@/errors/messages.js';
import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import {
  escapeValueForJS,
  formatScriptExecutionError,
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
  withValueMismatchWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  FILL_READ_BACK_SCRIPT,
  REACT_FILL_SCRIPT,
  CLICK_ELEMENT_SCRIPT,
  SHADOW_FIELD_JS,
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
  POINTER_ACTION_NOUN,
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
      if (!result.fileInput) return withValueMismatchWarning(await withReadBack(cdp, result));
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

/** How long reading a filled value back may take before it is skipped */
const READ_BACK_TIMEOUT_MS = 1000;

/**
 * Add the read-back of a successful fill ({@link FILL_READ_BACK_SCRIPT}):
 * `valueMismatch` when the field's value is not the one given. The fill
 * stands without it when the read-back fails, takes longer than
 * {@link READ_BACK_TIMEOUT_MS} or finds nothing (a change handler navigated
 * or replaced the page).
 *
 * @param cdp - CDP connection
 * @param result - Fill result
 * @returns The result, with `valueMismatch` when the value differs
 */
async function withReadBack(cdp: CDPConnection, result: FillResult): Promise<FillResult> {
  if (!result.success) return result;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READ_BACK_TIMEOUT_MS);
  });
  const readBack = cdp
    .send('Runtime.evaluate', {
      expression: FILL_READ_BACK_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
    })
    .then((response) => (response as { result?: { value?: unknown } }).result?.value)
    .catch((error: unknown) => {
      log.debug(`Filled value not read back: ${getErrorMessage(error)}`);
      return undefined;
    });
  const mismatch = await Promise.race([readBack, timedOut]).finally(() => clearTimeout(timer));
  return isValueMismatch(mismatch) ? { ...result, valueMismatch: mismatch } : result;
}

/**
 * Whether a read-back value is a mismatch.
 *
 * @param value - Value from {@link FILL_READ_BACK_SCRIPT}
 * @returns True for `{ expected, actual }`
 */
function isValueMismatch(value: unknown): value is FillValueMismatch {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['expected'] === 'string' && typeof obj['actual'] === 'string';
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
      expression: `((el) => (${LABEL_CONTROL_JS})(el) || (${SHADOW_FIELD_JS})(el) || el)((${FIND_ELEMENTS_JS})(${selectorArgsJS(selector)})[${options.index ?? 0}])`,
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
 * and evaluates to whether the mouse press reached the target and, when it
 * did not, the element it landed on (if the page saw it at all).
 */
const PRESS_PROBE_READ_SCRIPT = `(() => {
  const probe = window.__bdgPressProbe;
  delete window.__bdgPressProbe;
  if (!probe) return { reached: true };
  probe.stop();
  return { reached: probe.reached, landedOn: probe.landedOn };
})()`;

/** Whether a mouse press reached its target, and where it landed instead */
interface PressOutcome {
  reached: boolean;
  /** The element the press landed on, when it missed and the page saw it */
  landedOn?: string;
}

/**
 * Read the press probe: whether the mouse press just dispatched reached the
 * target element, and otherwise where it landed.
 *
 * Any doubt (no probe, evaluation failure) counts as reached, so only a
 * press that the page provably never saw is reported.
 *
 * @param cdp - CDP connection
 * @returns Outcome; not reached only when the target received no pointerdown/mousedown
 */
async function readPressProbe(cdp: CDPConnection): Promise<PressOutcome> {
  try {
    const response = (await cdp.send('Runtime.evaluate', {
      expression: PRESS_PROBE_READ_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: { reached?: unknown; landedOn?: unknown } } };
    const value = response.result?.value;
    if (value?.reached !== false) return { reached: true };
    return typeof value.landedOn === 'string'
      ? { reached: false, landedOn: value.landedOn }
      : { reached: false };
  } catch (error) {
    log.debug(`Press probe not read: ${getErrorMessage(error)}`);
    return { reached: true };
  }
}

/**
 * Whether the mouse press just dispatched reached the target element
 * (see {@link readPressProbe}).
 *
 * @param cdp - CDP connection
 * @returns False only when the target received no pointerdown/mousedown
 */
export async function pressReachedTarget(cdp: CDPConnection): Promise<boolean> {
  return (await readPressProbe(cdp)).reached;
}

/**
 * Dispatch real mouse events for an action, checking after the first press
 * that the target received it. With `stopIfMissed`, a press that missed is
 * only released (no further presses). If dispatching fails first, the press
 * probe is still removed from the page.
 *
 * @param cdp - CDP connection
 * @param action - What to do
 * @param point - Page coordinates
 * @param stopIfMissed - Stop after releasing a press that missed (--strict)
 * @returns Whether the first press reached the target, and where it landed otherwise
 */
async function dispatchMouseAction(
  cdp: CDPConnection,
  action: PointerAction,
  point: { x: number; y: number },
  stopIfMissed: boolean
): Promise<PressOutcome> {
  let outcome: PressOutcome | undefined;
  try {
    for (const event of mouseEvents(action, point.x, point.y)) {
      await cdp.send('Input.dispatchMouseEvent', event);
      if (event['type'] === 'mouseReleased' && outcome?.reached === false && stopIfMissed) break;
      if (event['type'] === 'mousePressed' && outcome === undefined) {
        outcome = await readPressProbe(cdp);
      }
    }
  } catch (error) {
    if (outcome === undefined) await readPressProbe(cdp);
    throw error;
  }
  return outcome ?? { reached: true };
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
 * Refuse a pointer action under `--strict` (exit 90, the page's state
 * conflicts with the request): the element is unreachable by the mouse, or
 * the press never reached it.
 *
 * @param result - Located click (selector and element description)
 * @param action - What was refused
 * @param why - Why the mouse could not reach it (nothing was sent), or the
 *   press that was sent and missed
 * @returns Never
 * @throws CommandError always
 */
function refuseUnreachable(
  result: ClickResult,
  action: PointerAction,
  why: { obstruction: string | null } | { missed: PressOutcome }
): never {
  const target = { selector: result.selector ?? '', element: result.element };
  const verb = POINTER_ACTION_NOUN[action];
  const err =
    'missed' in why
      ? pressNotReceivedError(target, verb, why.missed.landedOn)
      : unreachableElementError(target, why.obstruction, verb);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.RESOURCE_CONFLICT);
}

/**
 * Click a located element.
 *
 * Uses real mouse events (pointerdown/mousedown/pointerup/mouseup/click, all
 * trusted) at the element's center when it is the topmost element there, so
 * components that react to pointer or mouse events (menus, selects) respond.
 * Otherwise (covered or zero-size) falls back to `el.click()` and says so,
 * or with `strict` refuses (as it does when the press never reached it).
 * Double and right clicks, and hovering, work the same way.
 *
 * @param cdp - CDP connection
 * @param located - Locate result with center point
 * @param action - Click, double click, right click or hover
 * @param strict - Refuse instead of falling back to DOM events
 * @returns Click result
 * @throws CommandError under `strict` when a user could not reach the element
 */
async function performClick(
  cdp: CDPConnection,
  located: LocatedClick,
  action: PointerAction,
  strict: boolean
): Promise<ClickResult> {
  const { x, y, hittable, obstruction, ...result } = located;
  if (!result.success) return result;

  if (hittable && x !== undefined && y !== undefined) {
    const press = await dispatchMouseAction(cdp, action, { x, y }, strict);
    releaseClickTarget(cdp);
    if (!press.reached && strict) refuseUnreachable(result, action, { missed: press });
    return withMultipleMatchesWarning<ClickResult>(
      {
        ...result,
        action,
        method: 'mouse',
        ...(!press.reached && { warning: CLICK_NOT_RECEIVED_WARNING }),
      },
      result.selectedIndex,
      `${POINTER_ACTION_DONE[action].toLowerCase()} the first visible one`
    );
  }

  if (strict) {
    releaseClickTarget(cdp);
    refuseUnreachable(result, action, { obstruction: obstruction ?? null });
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
  options: { index?: number; action?: PointerAction; strict?: boolean } = {}
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
      return await performClick(cdp, cdpResponse.result.value, action, options.strict === true);
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
