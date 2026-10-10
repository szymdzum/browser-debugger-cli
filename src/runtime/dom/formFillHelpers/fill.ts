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
  fillTooLongError,
  clickTargetDetachedError,
  unexpectedResponseFormatError,
  operationFailedError,
  pressNotReceivedError,
  textTypedElsewhereError,
  unreachableElementError,
} from '@/errors/messages.js';
import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import {
  ActionScriptError,
  escapeValueForJS,
  exceptionSummary,
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
  withValueMismatchWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  FILL_FOCUS_CHECK_SCRIPT,
  FILL_INSERTED_FUNCTION,
  FILL_READ_BACK_SCRIPT,
  FIRE_EVENT_JS,
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
  clickLandedElsewhereWarning,
  POINTER_ACTION_DONE,
  POINTER_ACTION_NOUN,
  domClickFallbackWarning,
  fillNotTypedWarning,
  fillTooShortWarning,
  type FillNotTypedReason,
} from '@/ui/messages/commands.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * A fill result, plus what the page scripts report for the caller to word
 * (not part of the CLI result): whether the text was left for
 * {@link insertAsUser} to type, why a text field's value was set by script
 * instead, and the `minlength` a value is shorter than
 */
type FillOutcome = FillResult & {
  insertText?: true;
  notTyped?: FillNotTypedReason | FillNotTypedReason[];
  tooShort?: number;
  tooLong?: number;
};

/**
 * The refusal of a value over the field's `maxlength`, worded here (the
 * length given only for a field that is not secret).
 *
 * @param outcome - Fill script result with `tooLong`
 * @param value - Value given
 * @returns Failed fill result
 */
function tooLongFailure(outcome: FillOutcome & { tooLong: number }, value: string): FillResult {
  const { tooLong, sensitive, ...result } = outcome;
  const err = fillTooLongError(tooLong, sensitive ? undefined : value.length);
  return { ...result, success: false, error: err.message, suggestion: err.suggestion };
}

/**
 * Turn what the page scripts reported into warnings (worded here, so no
 * message text is put into page code), ahead of the page's own.
 *
 * @param outcome - Fill outcome
 * @returns The CLI result
 */
function withFillWarnings(outcome: FillOutcome): FillResult {
  const { insertText: _typed, notTyped, tooShort, ...result } = outcome;
  const warnings = [
    ...[notTyped ?? []].flat().map(fillNotTypedWarning),
    ...(tooShort !== undefined ? [fillTooShortWarning(tooShort)] : []),
    ...(result.warning ? [result.warning] : []),
  ];
  return warnings.length > 0 ? { ...result, warning: warnings.join('; ') } : result;
}

/**
 * Fill a form element with a value in a React-compatible way. A text field
 * gets the value as a user edit ({@link insertAsUser}), so the browser
 * applies `minlength` to it.
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
      throw new ActionScriptError('fill', exceptionSummary(cdpResponse.exceptionDetails), selector);
    }

    if (cdpResponse.result?.value && isFillResult(cdpResponse.result.value)) {
      const result: FillOutcome = cdpResponse.result.value;
      if (result.tooLong !== undefined)
        return tooLongFailure({ ...result, tooLong: result.tooLong }, value);
      if (!result.fileInput) {
        const filled = result.insertText
          ? await insertAsUser(cdp, { selector, value }, result)
          : result;
        return withValueMismatchWarning(await withReadBack(cdp, withFillWarnings(filled)));
      }
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

/** What {@link FILL_INSERTED_FUNCTION} evaluates to */
type FilledField =
  | {
      value: string;
      sensitive?: true;
      warning?: string;
      tooShort?: number;
      notTyped?: FillNotTypedReason;
      typedInto?: undefined;
    }
  | { typedInto: string };

/**
 * Type the value with CDP `Input.insertText`, unless the field the fill
 * script focused and emptied lost the focus meanwhile
 * ({@link FILL_FOCUS_CHECK_SCRIPT}); then finish the fill
 * ({@link FILL_INSERTED_FUNCTION}). Chrome takes typed text as a user edit,
 * so `minlength` applies. When nothing was pending any more (the page
 * navigated) the fill script's result stands.
 *
 * @param cdp - CDP connection
 * @param fill - The selector filled and the text to type
 * @param pending - Result of the fill script, with `insertText`
 * @returns Fill outcome
 * @throws CommandError (exit 90) when the page moved the focus and the text
 *   went to another field; ActionScriptError when the finishing script
 *   threw (a page API it calls was replaced)
 */
async function insertAsUser(
  cdp: CDPConnection,
  fill: { selector: string; value: string },
  pending: FillOutcome
): Promise<FillOutcome> {
  const { insertText: _typed, ...result } = pending;
  const reason = await typeText(cdp, fill.value);
  const response = (await cdp.send('Runtime.evaluate', {
    expression: `(${FILL_INSERTED_FUNCTION})(${reason === null ? 'true' : 'false'})`,
    returnByValue: true,
    userGesture: true,
  })) as { result?: { value?: unknown }; exceptionDetails?: Protocol.Runtime.ExceptionDetails };
  if (response.exceptionDetails) {
    throw new ActionScriptError('fill', exceptionSummary(response.exceptionDetails), fill.selector);
  }
  const done = response.result?.value as FilledField | null | undefined;
  if (!done) return result;
  if (done.typedInto !== undefined) {
    const err = textTypedElsewhereError(
      { selector: result.selector ?? '', element: result.element },
      done.typedInto
    );
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_CONFLICT
    );
  }
  const { sensitive: _sensitive, warning: _warning, ...field } = result;
  const notTyped = [reason, done.notTyped].filter((why) => why !== null && why !== undefined);
  return {
    ...field,
    value: done.value,
    ...(done.sensitive && { sensitive: true }),
    ...(done.warning && { warning: done.warning }),
    ...(done.tooShort !== undefined && { tooShort: done.tooShort }),
    ...(notTyped.length > 0 && { notTyped }),
  };
}

/**
 * Type the text into the pending field when it still has the focus.
 *
 * @param cdp - CDP connection
 * @param value - Text to type
 * @returns Null when typed, else why not
 */
async function typeText(cdp: CDPConnection, value: string): Promise<'unfocused' | 'failed' | null> {
  const check = (await cdp.send('Runtime.evaluate', {
    expression: FILL_FOCUS_CHECK_SCRIPT,
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  if (check.result?.value !== true) return 'unfocused';
  try {
    await cdp.send('Input.insertText', { text: value });
    return null;
  } catch (error) {
    log.debug(`Text not typed: ${getErrorMessage(error)}`);
    return 'failed';
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
  (${FIRE_EVENT_JS})(this, 'input');
  (${FIRE_EVENT_JS})(this, 'change');
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

/**
 * A click's result, plus whether its script left a probe on the submit
 * button's form (`readBlockedSubmit` reads it; not part of the CLI result)
 */
export type ClickOutcome = ClickResult & { submitProbe?: true };

/** Click target as located by CLICK_ELEMENT_SCRIPT. */
type LocatedClick = ClickOutcome & {
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
): Promise<ClickOutcome> {
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
        ...(!press.reached && {
          warning:
            press.landedOn === undefined
              ? CLICK_NOT_RECEIVED_WARNING
              : clickLandedElsewhereWarning(press.landedOn),
        }),
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
): Promise<ClickOutcome> {
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
      throw new ActionScriptError(
        POINTER_ACTION_NOUN[action],
        exceptionSummary(cdpResponse.exceptionDetails),
        selector
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
