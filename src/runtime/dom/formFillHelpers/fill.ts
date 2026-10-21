/**
 * Fill and click operations — inject React-compatible page-context scripts
 * and unpack structured results.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CDPConnection } from '@/connection/cdp.js';
import { sendTyped } from '@/connection/typed-cdp.js';
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
  layoutNextStep,
  pressNotReceivedError,
  pressTargetReplacedError,
  textTypedElsewhereError,
  unreachableElementError,
  optionNotFoundError,
} from '@/errors/messages.js';
import type { FillValueMismatch, OptionNotFound } from '@/ipc/protocol/domTypes.js';
import {
  ActionScriptError,
  exceptionSummary,
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  FILL_FOCUS_CHECK_SCRIPT,
  FILL_INSERTED_FUNCTION,
  FILL_LATE_READ_FUNCTION,
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
import { FIND_ELEMENTS_JS, LABEL_CONTROL_JS, selectorArgs } from '@/runtime/dom/targetNode.js';
import { callFunctionInMainWorld } from '@/runtime/page/bdgWorld.js';
import { releaseObjectGroup } from '@/runtime/page/objectGroups.js';
import { createLogger } from '@/ui/logging/index.js';
import {
  clickLandedElsewhereWarning,
  clickNotReceivedWarning,
  clickTargetReplacedWarning,
  coverText,
  POINTER_ACTION_DONE,
  POINTER_ACTION_NOUN,
  domClickFallbackWarning,
  fillNotTypedWarning,
  fillTooShortWarning,
  type FillNotTypedReason,
} from '@/ui/messages/commands.js';
import { delay, raceTimeout } from '@/utils/async.js';
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
  optionNotFound?: OptionNotFound;
};

/**
 * The refusal of a select value matching no option, worded here (#625: the
 * value and the options are given only for a select that holds no secret).
 *
 * @param outcome - Fill script result with `optionNotFound`
 * @returns Failed fill result
 */
function optionNotFoundFailure(
  outcome: FillOutcome & { optionNotFound: OptionNotFound }
): FillResult {
  const { optionNotFound, ...result } = outcome;
  const err = optionNotFoundError(optionNotFound);
  return { ...result, success: false, error: err.message, suggestion: err.suggestion };
}

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

  try {
    const response = await callFunctionInMainWorld(cdp, {
      functionDeclaration: REACT_FILL_SCRIPT,
      arguments: [...selectorArgs(selector), value, scriptOptions].map((value) => ({ value })),
      returnByValue: true,
      userGesture: true,
    });

    if (response.exceptionDetails) {
      throwIfInvalidSelector(response.exceptionDetails, selector);
      throw new ActionScriptError('fill', exceptionSummary(response.exceptionDetails), selector);
    }

    if (response.result?.value && isFillResult(response.result.value)) {
      const result: FillOutcome = response.result.value;
      if (result.tooLong !== undefined)
        return tooLongFailure({ ...result, tooLong: result.tooLong }, value);
      if (result.optionNotFound !== undefined)
        return optionNotFoundFailure({ ...result, optionNotFound: result.optionNotFound });
      if (!result.fileInput) {
        const filled = result.insertText
          ? await insertAsUser(cdp, { selector, value, listIndex: options.listIndex }, result)
          : result;
        return withReadBack(cdp, withFillWarnings(filled));
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
 * @param fill - The selector filled, the text to type, and the index the
 *   user gave for a listed element
 * @param pending - Result of the fill script, with `insertText`
 * @returns Fill outcome
 * @throws CommandError (exit 90) when the page moved the focus and the text
 *   went to another field; ActionScriptError when the finishing script
 *   threw (a page API it calls was replaced)
 */
async function insertAsUser(
  cdp: CDPConnection,
  fill: { selector: string; value: string; listIndex?: number | undefined },
  pending: FillOutcome
): Promise<FillOutcome> {
  const { insertText: _typed, ...result } = pending;
  const reason = await typeText(cdp, fill.value);
  const response = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: `(${FILL_INSERTED_FUNCTION})(${reason === null ? 'true' : 'false'})`,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new ActionScriptError('fill', exceptionSummary(response.exceptionDetails), fill.selector);
  }
  const done = response.result?.value as FilledField | null | undefined;
  if (!done) return result;
  if (done.typedInto !== undefined) {
    const err = textTypedElsewhereError(
      { selector: result.selector ?? '', element: result.element, listIndex: fill.listIndex },
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
  const check = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: FILL_FOCUS_CHECK_SCRIPT,
    returnByValue: true,
  });
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
 * When a fill's value is read again (#892), after the fill: later than the
 * reverts seen (50 ms to 1.5 s; a 1500 ms timer measured 42 ms late on a
 * busy, CPU-throttled page), and the longest an action waits for the
 * network, so the read runs within that wait
 */
const LATE_READ_BACK_MS = 2000;

/**
 * Add the read-back of a successful fill ({@link FILL_READ_BACK_SCRIPT}):
 * `valueMismatch` when the field's value is not the one given (the CLI
 * fails the fill with exit 90 for it). The fill stands without it when the
 * read-back fails or finds nothing ({@link readMismatch}).
 *
 * @param cdp - CDP connection
 * @param result - Fill result
 * @returns The result, with `valueMismatch` when the value differs
 */
async function withReadBack(cdp: CDPConnection, result: FillResult): Promise<FillResult> {
  if (!result.success) return result;
  const mismatch = await readMismatch(
    sendTyped(cdp, 'Runtime.evaluate', {
      expression: FILL_READ_BACK_SCRIPT,
      returnByValue: true,
      awaitPromise: true,
    })
  );
  return mismatch ? { ...result, valueMismatch: mismatch } : result;
}

/**
 * Read the value of the field a fill filled again {@link LATE_READ_BACK_MS}
 * after it ({@link FILL_LATE_READ_FUNCTION}), so a value the page reverted
 * meanwhile fails the fill too (#892). Started with the fill and run
 * alongside the network-idle wait; nothing is read when the fill failed,
 * its read-back already found a mismatch, or it filled a file input. A
 * remounted field is found again by the fill's selector and index.
 *
 * @param cdp - CDP connection of the field's page
 * @param target - Selector (or bound-node placeholder) and index the fill used
 * @param filling - The fill
 * @returns The revert, or undefined
 */
export async function readBackLate(
  cdp: CDPConnection,
  target: { selector: string; index?: number | undefined },
  filling: Promise<FillResult>
): Promise<FillValueMismatch | undefined> {
  const filled = await filling;
  if (!filled.success || filled.valueMismatch || filled.inputType === 'file') return undefined;
  await delay(LATE_READ_BACK_MS);
  return readMismatch(
    callFunctionInMainWorld(cdp, {
      functionDeclaration: FILL_LATE_READ_FUNCTION,
      arguments: [...selectorArgs(target.selector), target.index ?? 0].map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    })
  );
}

/**
 * Fail a fill whose value the page reverted after it ({@link readBackLate}):
 * `valueMismatch`, and `lateRevert` for the suggestion.
 *
 * @param result - Fill result
 * @param revert - What the late read found
 * @returns The result, with the revert
 */
export function withLateRevert(result: FillResult, revert?: FillValueMismatch): FillResult {
  return revert && result.success && !result.valueMismatch
    ? { ...result, valueMismatch: revert, lateRevert: true }
    : result;
}

/**
 * The mismatch a read-back evaluates to; none when the read fails or takes
 * longer than {@link READ_BACK_TIMEOUT_MS} (a change handler navigated or
 * replaced the page, or the page is busy).
 *
 * @param read - The read-back call
 * @returns The mismatch, or undefined
 */
async function readMismatch(
  read: Promise<{ result?: { value?: unknown } }>
): Promise<FillValueMismatch | undefined> {
  const value = read
    .then((response): unknown => response.result?.value)
    .catch((error: unknown) => {
      log.debug(`Filled value not read back: ${getErrorMessage(error)}`);
      return undefined;
    });
  const mismatch = await raceTimeout(value, READ_BACK_TIMEOUT_MS);
  return isValueMismatch(mismatch) ? mismatch : undefined;
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

/** Numbers the object groups of file uploads: one per upload, so concurrent ones keep theirs */
let uploads = 0;

/**
 * Page function: the file input a fill by selector (or bound node) and index
 * acts on: the match, or the control of a matching `<label>` or the field in
 * a matching shadow host. Every parameter is a `Runtime.callFunctionOn`
 * argument.
 */
const FIND_FILE_INPUT_FUNCTION = `function (selector, parts, index) {
  const el = (${FIND_ELEMENTS_JS})(selector, parts)[index];
  return (${LABEL_CONTROL_JS})(el) || (${SHADOW_FIELD_JS})(el) || el;
}`;

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
  const objectGroup = `bdg-upload-${++uploads}`;
  try {
    const located = await callFunctionInMainWorld(cdp, {
      functionDeclaration: FIND_FILE_INPUT_FUNCTION,
      arguments: [...selectorArgs(selector), options.index ?? 0].map((value) => ({ value })),
      objectGroup,
    });
    if (located.exceptionDetails) throwIfInvalidSelector(located.exceptionDetails, selector);
    const objectId = located.result?.objectId;
    if (!objectId) {
      const err = fillableElementNotFoundError(selector);
      return { success: false, error: err.message, suggestion: err.suggestion };
    }
    const multiple = await sendTyped(cdp, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this.multiple; }',
      returnByValue: true,
    });
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
    await releaseObjectGroup(cdp, objectGroup);
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
 * the mouse cannot reach it); evaluates to false if the target is gone. Elements
 * without a `click()` method (SVG, MathML) get a dispatched `click` event.
 *
 * @param action - What to do
 * @returns Script
 */
function domFallbackScript(action: PointerAction): string {
  const events: Record<PointerAction, string> = {
    click: 'press();',
    double: "press(); press(); el.dispatchEvent(new MouseEvent('dblclick', init));",
    right: "el.dispatchEvent(new MouseEvent('contextmenu', { ...init, button: 2 }));",
    hover:
      "['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove'].forEach((type) => el.dispatchEvent(new MouseEvent(type, init)));",
  };
  return `(() => {
  const el = window.__bdgClickTarget;
  delete window.__bdgClickTarget;
  if (!el || !el.isConnected) return false;
  const init = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView };
  const press = () => typeof el.click === 'function' ? el.click() : el.dispatchEvent(new MouseEvent('click', init));
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
 * Page script that reads the press probe installed by CLICK_ELEMENT_SCRIPT:
 * whether the mouse press reached the target, when it did not the element it
 * landed on (if the page saw it at all), and whether the target got no click
 * and is gone from the page (`replaced`). Evaluated once right after the
 * press (it leaves the probe in place), and once at the end (it stops the
 * probe).
 */
const PRESS_PROBE_PEEK_SCRIPT = `(() => {
  const probe = window.__bdgPressProbe;
  if (!probe) return { reached: true };
  return { reached: probe.reached || probe.hidden, landedOn: probe.landedOn, releasedOn: probe.releasedOn, replaced: !probe.clicked && probe.replaced() };
})()`;

/** {@link PRESS_PROBE_PEEK_SCRIPT}, then stops the probe */
const PRESS_PROBE_READ_SCRIPT = `(() => {
  const outcome = ${PRESS_PROBE_PEEK_SCRIPT};
  const probe = window.__bdgPressProbe;
  delete window.__bdgPressProbe;
  if (probe) probe.stop();
  return outcome;
})()`;

/** Longest bdg waits to read whether the target got its click after a press */
const PRESS_SETTLE_TIMEOUT_MS = 300;

/** Whether a mouse press reached its target, and where it landed instead */
interface PressOutcome {
  reached: boolean;
  /** The element the press landed on, when it missed and the page saw it */
  landedOn?: string;
  /** The press reached the element but it left the page without getting a click */
  replaced?: true;
  /** The press reached the element but the mouse was released on this other one */
  releasedOn?: string;
}

/**
 * Read the press probe: whether the mouse press just dispatched reached the
 * target element, and otherwise where it landed.
 *
 * Any doubt (no probe, evaluation failure) counts as reached, so only a
 * press that the page provably never saw is reported.
 *
 * @param cdp - CDP connection
 * @param stop - Also stop the probe (the last read)
 * @returns Outcome; not reached only when the target received no pointerdown/mousedown
 */
async function readPressProbe(cdp: CDPConnection, stop: boolean): Promise<PressOutcome> {
  try {
    const read = sendTyped(cdp, 'Runtime.evaluate', {
      expression: stop ? PRESS_PROBE_READ_SCRIPT : PRESS_PROBE_PEEK_SCRIPT,
      returnByValue: true,
    });
    const response = await (stop ? withinSettleTime(read) : read);
    const value = response?.result?.value as PressProbeValue | undefined;
    if (value?.reached !== false) {
      return {
        reached: true,
        ...(value?.replaced === true && { replaced: true as const }),
        ...(typeof value?.releasedOn === 'string' && { releasedOn: value.releasedOn }),
      };
    }
    return typeof value.landedOn === 'string'
      ? { reached: false, landedOn: value.landedOn }
      : { reached: false };
  } catch (error) {
    log.debug(`Press probe not read: ${getErrorMessage(error)}`);
    return { reached: true };
  }
}

/**
 * Wait for a page evaluation after a press, but not for a page that is
 * navigating away (its evaluations wait until the new page commits, which
 * `--no-wait` must not): a navigation shows the click did something.
 *
 * @param pending - The evaluation
 * @returns Its response, or null when it took longer than {@link PRESS_SETTLE_TIMEOUT_MS}
 */
async function withinSettleTime<T>(pending: Promise<T>): Promise<T | null> {
  pending.catch((error: unknown) => log.debug(`Late press probe read: ${getErrorMessage(error)}`));
  return raceTimeout(pending, PRESS_SETTLE_TIMEOUT_MS, { onTimeout: () => null });
}

/** What the press probe scripts return. */
interface PressProbeValue {
  reached?: unknown;
  landedOn?: unknown;
  replaced?: unknown;
  releasedOn?: unknown;
}

/**
 * Whether the mouse press just dispatched reached the target element
 * (see {@link readPressProbe}).
 *
 * @param cdp - CDP connection
 * @returns False only when the target received no pointerdown/mousedown
 */
export async function pressReachedTarget(cdp: CDPConnection): Promise<boolean> {
  return (await readPressProbe(cdp, true)).reached;
}

/**
 * Dispatch real mouse events for an action, checking after the first press
 * that the target received it, and after all of them that it was not removed
 * without getting a click (`replaced`). With `stopIfMissed`, a press that
 * missed is only released (no further presses). If dispatching fails first, the press
 * probe is still removed from the page.
 *
 * @param cdp - CDP connection
 * @param action - What to do
 * @param point - Page coordinates
 * @param stopIfMissed - Stop after releasing a press that missed (--strict)
 * @returns Whether the first press reached the target, where it landed otherwise, and whether the target was replaced
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
        outcome = await readPressProbe(cdp, false);
      }
    }
  } catch (error) {
    await readPressProbe(cdp, true);
    throw error;
  }
  if (outcome === undefined) return { reached: true };
  const settled = await readPressProbe(cdp, true);
  return outcome.reached ? settled : outcome;
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
  cover?: { by: string; transparent: boolean };
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
 * @param listIndex - Index the user gave for a listed element, named in the suggestion
 * @returns Never
 * @throws CommandError always
 */
function refuseUnreachable(
  result: ClickResult,
  action: PointerAction,
  why: { reason: string | null } | { missed: PressOutcome },
  listIndex: number | undefined
): never {
  const target = { selector: result.selector ?? '', element: result.element, listIndex };
  const verb = POINTER_ACTION_NOUN[action];
  const err =
    'missed' in why
      ? why.missed.replaced
        ? pressTargetReplacedError(target, verb)
        : pressNotReceivedError(target, verb, why.missed.landedOn)
      : unreachableElementError(target, why.reason, verb);
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
 * @param listIndex - Index the user gave for a listed element (named when refused)
 * @returns Click result
 * @throws CommandError under `strict` when a user could not reach the element
 */
async function performClick(
  cdp: CDPConnection,
  located: LocatedClick,
  action: PointerAction,
  strict: boolean,
  listIndex?: number
): Promise<ClickOutcome> {
  const { x, y, hittable, obstruction, cover, ...result } = located;
  if (!result.success) return result;
  const reason = cover ? coverText(cover.by, cover.transparent) : obstruction;

  if (hittable && x !== undefined && y !== undefined) {
    const press = await dispatchMouseAction(cdp, action, { x, y }, strict);
    releaseClickTarget(cdp);
    const replaced = press.replaced === true && action !== 'right';
    if ((!press.reached || replaced) && strict) {
      refuseUnreachable(
        result,
        action,
        { missed: replaced ? { ...press, replaced: true } : press },
        listIndex
      );
    }
    const nextStep = layoutNextStep({
      selector: result.selector ?? '',
      listIndex,
    });
    return withMultipleMatchesWarning<ClickResult>(
      {
        ...result,
        action,
        method: 'mouse',
        ...(!press.reached && {
          warning:
            press.landedOn === undefined
              ? clickNotReceivedWarning(nextStep)
              : clickLandedElsewhereWarning(press.landedOn, nextStep),
        }),
        ...(press.reached && replaced && { warning: clickTargetReplacedWarning() }),
        ...(press.reached && press.releasedOn !== undefined && { releasedOn: press.releasedOn }),
      },
      result.selectedIndex,
      `${POINTER_ACTION_DONE[action].toLowerCase()} the first visible one`
    );
  }

  if (strict) {
    releaseClickTarget(cdp);
    refuseUnreachable(result, action, { reason: reason ?? null }, listIndex);
  }
  const response = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: domFallbackScript(action),
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new ActionScriptError(
      POINTER_ACTION_NOUN[action],
      exceptionSummary(response.exceptionDetails),
      result.selector ?? ''
    );
  }
  if (response.result?.value !== true) {
    const err = clickTargetDetachedError(result.selector ?? '');
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return withMultipleMatchesWarning<ClickResult>(
    { ...result, action, method: 'dom', warning: domClickFallbackWarning(reason) },
    result.selectedIndex,
    `${POINTER_ACTION_DONE[action].toLowerCase()} the first visible one`
  );
}

/**
 * Click an element.
 *
 * @param cdp - CDP connection
 * @param selector - Selector, or the bound-node placeholder
 * @param options - Match index, pointer action, `--strict`, and the index the
 *   user gave for a listed element (named when `--strict` refuses)
 * @returns Click result
 */
export async function clickElement(
  cdp: CDPConnection,
  selector: string,
  options: { index?: number; action?: PointerAction; strict?: boolean; listIndex?: number } = {}
): Promise<ClickOutcome> {
  const action = options.action ?? 'click';

  try {
    const response = await callFunctionInMainWorld(cdp, {
      functionDeclaration: CLICK_ELEMENT_SCRIPT,
      arguments: [...selectorArgs(selector), options.index ?? null, action].map((value) => ({
        value,
      })),
      returnByValue: true,
      userGesture: true,
    });

    if (response.exceptionDetails) {
      throwIfInvalidSelector(response.exceptionDetails, selector);
      throw new ActionScriptError(
        POINTER_ACTION_NOUN[action],
        exceptionSummary(response.exceptionDetails),
        selector
      );
    }

    if (response.result?.value && isClickResult(response.result.value)) {
      return await performClick(
        cdp,
        response.result.value,
        action,
        options.strict === true,
        options.listIndex
      );
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
