/**
 * DOM action error messages.
 */

import type { FillValueMismatch } from '@/ipc/protocol/domTypes.js';
import { joinLines } from '@/ui/formatting.js';
import { closedShadowRootMessage, valueMismatchWarning } from '@/ui/messages/commands.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { detectSelectorQuoteDamage } from '@/utils/shellDetection.js';

import {
  type ErrorWithSuggestion,
  pageStillLoadingHint,
  A11Y_NAME_QUERY_EXAMPLE,
  noMatchMessage,
  shellQuote,
} from './shared.js';

/**
 * A numeric index given together with `--index`.
 *
 * @param index - The index argument
 * @param command - The `bdg dom` subcommand it was given to, e.g. "layout"
 */
export function indexWithIndexOptionError(index: string, command: string): ErrorWithSuggestion {
  return {
    message: `--index applies to a selector, but "${index}" is already an index from the last query`,
    suggestion: `Use one: bdg dom ${command} ${index}, or bdg dom ${command} "<selector>" --index <n>`,
  };
}

/** Problems with `bdg dom scroll` options, and how to fix each */
const SCROLL_PROBLEMS = {
  'index-without-selector': [
    '--index requires a selector',
    'Use: bdg dom scroll "selector" --index 2',
  ],
  vertical: [
    'Conflicting scroll directions: --up/--down/--top/--bottom',
    'Use one vertical direction',
  ],
  horizontal: ['Conflicting scroll directions: --left and --right', 'Use either --left or --right'],
  'selector-with-offset': [
    'A selector cannot be combined with --up/--down/--left/--right/--top/--bottom',
    'Scroll to the element (bdg dom scroll "footer"), or by an offset (bdg dom scroll --down 500)',
  ],
  'no-target': [
    'No scroll target specified',
    'Provide a selector (bdg dom scroll "footer") or offset (--down 500, --bottom)',
  ],
} as const;

/**
 * Invalid `bdg dom scroll` options.
 *
 * @param problem - Which rule was broken
 */
export function scrollOptionsError(problem: keyof typeof SCROLL_PROBLEMS): ErrorWithSuggestion {
  const [message, suggestion] = SCROLL_PROBLEMS[problem];
  return { message, suggestion };
}

/** The key groups `dom press-key` accepts, listed when no key name is close to the input */
const KEY_GROUPS_SUGGESTION =
  "Keys: Enter, NumpadEnter, Tab, Escape, Space, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12, Shift, Control, Alt, Meta, a-z, A-Z, 0-9, punctuation and shifted symbols (. , - _ / ; ' [ ] \\ = ` ! @ ? ...), or a DOM code name (Period, Minus)";

/**
 * A key name `dom press-key` does not know (or an empty one).
 *
 * @param keyName - Key as given
 * @param similar - Similar key names
 */
export function unknownKeyError(keyName: string, similar: string[]): ErrorWithSuggestion {
  return {
    message: keyName === '' ? 'Key name required' : `Unknown key: "${keyName}"`,
    suggestion: similar.length ? `Did you mean: ${similar.join(', ')}?` : KEY_GROUPS_SUGGESTION,
  };
}

/**
 * `dom screenshot` given an element both as an argument and as an option,
 * and they differ.
 *
 * @param option - The option and its value, e.g. `--selector #a`
 * @param positional - The element argument
 * @returns Message and suggestion
 */
export function conflictingTargetError(option: string, positional: string): ErrorWithSuggestion {
  return {
    message: `${option} and the element argument "${positional}" name different elements`,
    suggestion: 'Name the element once: bdg dom screenshot <path> <selector|index>',
  };
}

/**
 * Two options given together where one would be ignored.
 *
 * @param first - First option
 * @param second - Option it conflicts with
 * @returns Message and suggestion
 */
export function conflictingOptionsError(first: string, second: string): ErrorWithSuggestion {
  return {
    message: `${first} cannot be combined with ${second}`,
    suggestion: `Use one of them: drop ${first} or ${second}`,
  };
}

/** Why a page scroll moved nothing */
export interface ScrollNoEffect {
  /** Direction asked for */
  direction: 'up' | 'down' | 'left' | 'right';
  /** The document is no larger than the viewport, the page was at its edge already, or it did not move although it could */
  reason: 'too-small' | 'at-edge' | 'locked';
  /** Viewport size along the axis (px) */
  viewport: number;
  /** The page's `document.readyState` */
  readyState: string;
}

/** Edge of the page in each direction */
const SCROLL_EDGES = { up: 'top', down: 'bottom', left: 'left edge', right: 'right edge' };

/**
 * Warning of `bdg dom scroll` when the page did not move, with the
 * still-loading hint while the document is not complete (it may grow).
 *
 * @param effect - Why nothing scrolled
 * @returns e.g. `Nothing to scroll: the document is no taller than the viewport (993px)`
 */
export function scrollNoEffectWarning(effect: ScrollNoEffect): string {
  const vertical = effect.direction === 'up' || effect.direction === 'down';
  const reasons = {
    'too-small': `Nothing to scroll: the document is no ${vertical ? 'taller' : 'wider'} than the viewport (${effect.viewport}px)`,
    'at-edge': `Nothing scrolled: the page is already at the ${SCROLL_EDGES[effect.direction]}`,
    locked:
      'Nothing scrolled although the page is larger than the viewport; its scrolling may be locked (e.g. overflow: hidden while a dialog is open)',
  };
  const loading =
    effect.readyState === 'complete' ? undefined : pageStillLoadingHint(effect.readyState);
  return [reasons[effect.reason], loading].filter(Boolean).join('. ');
}

/**
 * Element not visible/rendered.
 */
export function elementNotVisibleError(): ErrorWithSuggestion {
  return {
    message: 'Element is not rendered (e.g. display: none), so it has no area to capture',
    suggestion: 'Make it visible first, or capture a visible ancestor',
  };
}

/**
 * Element has zero dimensions.
 */
export function elementZeroDimensionsError(): ErrorWithSuggestion {
  return {
    message: 'Element has zero width or height, so there is nothing to capture',
    suggestion: 'It may be collapsed or empty; capture a visible ancestor instead',
  };
}

/**
 * `bdg dom hover --off` was given an element too.
 *
 * @returns Message and suggestion
 */
export function hoverOffWithTargetError(): ErrorWithSuggestion {
  return {
    message: '--off moves the mouse off the page; it takes no element',
    suggestion: 'Use bdg dom hover --off alone, or bdg dom hover <selector> to hover an element',
  };
}

/**
 * Invalid query pattern.
 */
export function invalidQueryPatternError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'Query pattern must specify at least one field',
    suggestion: `Received: "${pattern}". Try: bdg dom a11y query role=button, or ${A11Y_NAME_QUERY_EXAMPLE}`,
  };
}

/**
 * A file to upload does not exist.
 *
 * @param file - Path that was not found
 */
export function fileNotFoundError(file: string): ErrorWithSuggestion {
  return {
    message: `File not found: ${file}`,
    suggestion:
      'Relative paths are resolved against the directory you run bdg in; separate several files with commas',
  };
}

/**
 * A directory given for a file input.
 *
 * @param file - Resolved path
 */
export function uploadDirectoryError(file: string): ErrorWithSuggestion {
  return {
    message: `Not a file: ${file} is a directory`,
    suggestion: 'Give the path of a file inside it',
  };
}

/**
 * Several files given for a file input that accepts one.
 *
 * @param count - Number of files given
 */
export function singleFileInputError(count: number): ErrorWithSuggestion {
  return {
    message: `This file input accepts a single file (${count} given)`,
    suggestion:
      'Pass one path; only inputs with the "multiple" attribute take a comma-separated list',
  };
}

/**
 * Fillable element not found.
 */
export function fillableElementNotFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: noMatchMessage(selector),
    suggestion: 'Verify the selector matches a fillable element (input, textarea, select)',
  };
}

/** Appended to the element type when an action went to a label's control. */
export const VIA_LABEL_SUFFIX = ' (via label)';

/** Placeholder for the shell-quoted `name=…` field in {@link LABEL_WITHOUT_CONTROL}. */
export const NAME_QUERY_PLACEHOLDER = '{nameQuery}';

/**
 * Filling a `<label>` that has no form control (used by the page script,
 * which puts the label's quoted `name=<text>` in place of
 * {@link NAME_QUERY_PLACEHOLDER}).
 */
export const LABEL_WITHOUT_CONTROL: ErrorWithSuggestion = {
  message: 'Element is not fillable (a <label> not associated with a form control)',
  suggestion: `Find the field by its accessible name: bdg dom a11y query ${NAME_QUERY_PLACEHOLDER}, or list the form fields: bdg dom form`,
};

/**
 * Why `dom fill` refused an element (used by the page script, which adds the
 * cause in parentheses, e.g. `The element is read-only (contenteditable="false")`).
 * All are invalid targets (exit 81), like any element that is not fillable.
 */
export const FILL_REFUSALS = {
  disabled: {
    message: 'The element is disabled',
    suggestion: 'Enable the field first (it may depend on another input)',
  },
  readOnly: {
    message: 'The element is read-only',
    suggestion: 'A user cannot change it either; the page has to make it editable first',
  },
  inert: {
    message: 'The element is inert',
    suggestion:
      'The page made it non-interactive (often behind a dialog); close what covers it first',
  },
  notFillable: {
    message: 'Element is not fillable',
    suggestion: 'Only input, textarea, select, and contenteditable elements can be filled',
  },
} as const satisfies Record<string, ErrorWithSuggestion>;

/**
 * Click target disappeared between locating and clicking it.
 */
export function clickTargetDetachedError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element was removed before it could be clicked: ${selector}`,
    suggestion: 'The page changed during the click; wait for it to settle and retry',
  };
}

/**
 * An action's page script threw (on a page whose built-ins all look like the
 * browser's): the page's own code failed, not bdg's.
 *
 * @param action - The action, e.g. `fill`
 * @param exception - What the script threw, e.g. `TypeError: x is not a function`
 * @param selector - Selector the action was for
 * @param listIndex - Index the user gave for a listed element; named instead of the selector (the cached query's key, not a selector the user can run)
 * @returns Error naming the exception
 */
export function actionScriptFailedError(
  action: string,
  exception: string,
  selector: string,
  listIndex?: number
): ErrorWithSuggestion {
  const message = `The page's own code threw during the ${action}: ${exception}`;
  const cause = `An event listener or a method the page replaced on the element (focus, click, dispatchEvent) threw: check`;
  const inspect = `or inspect its methods with ${sessionCommand("bdg eval '…'")}`;
  if (Number.isInteger(listIndex) && (listIndex ?? -1) >= 0) {
    return {
      message,
      suggestion: `${cause} ${sessionCommand(`bdg dom listeners ${listIndex}`)}, ${inspect}`,
    };
  }
  const damage = detectSelectorQuoteDamage(selector);
  const checkListeners = `${cause} ${sessionCommand(`bdg dom listeners ${JSON.stringify(selector)}`)}, ${inspect}`;
  const quoting = `. If the selector was damaged by shell quoting${damage.details ? ` (${damage.details})` : ''}, query it first with ${sessionCommand(`bdg dom query ${JSON.stringify(selector)}`)}, then act on the index`;
  return { message, suggestion: damage.damaged ? checkListeners + quoting : checkListeners };
}

/**
 * An action's page script threw on a page that replaced built-ins it uses
 * (anti-bot scripts make `getBoundingClientRect`, `focus` or
 * `dispatchEvent` throw; old libraries such as MooTools 1.2 replace
 * `Event`). All replaced built-ins are named.
 *
 * @param action - The action, e.g. `fill`
 * @param exception - What the script threw, e.g. `Error: anti-bot: focus`
 * @param replaced - Dotted names of the replaced built-ins
 * @returns Error naming the replaced built-ins and the exception
 */
export function actionBrokenByPageError(
  action: string,
  exception: string,
  replaced: readonly string[]
): ErrorWithSuggestion {
  const fill =
    action === 'fill'
      ? ' The field may already hold the value without the page having seen input or change events.'
      : '';
  return {
    message: `The page replaced built-ins bdg's ${action} script uses (${replaced.join(', ')}), and the script failed: ${exception}`,
    suggestion: `The page blocks or changes these APIs (an anti-bot script or an old library).${fill} If the page still lets scripts act, use ${sessionCommand("bdg eval '…'")}`,
  };
}

/**
 * A pointer action refused under `--strict` because a real mouse could not
 * reach the element (covered, hidden, zero-size, pointer-events: none).
 *
 * @param target - Selector and element description, as the click located it, and the index the user gave for a listed element
 * @param reason - Why the mouse could not reach it, e.g. "covered by div#shield"
 * @param verb - What was refused, e.g. "click", "hover"
 * @returns Message naming the obstruction, and how to inspect it
 */
export function unreachableElementError(
  target: ActedElement,
  reason: string | null | undefined,
  verb: string
): ErrorWithSuggestion {
  const element = target.element ?? target.selector;
  return {
    message: `Did not ${verb} ${element}: it is ${reason ?? 'not reachable by the mouse'}, so a user could not ${verb} it (--strict)`,
    suggestion: `See what is in the way with ${sessionCommand(`bdg dom layout ${elementArgument(target)}`)}, then close the overlay or scroll; without --strict bdg uses DOM events instead`,
  };
}

/** An element an action was refused for: its selector and description, and the index the user gave for a listed element */
interface ActedElement {
  selector: string;
  element?: string | undefined;
  listIndex?: number | undefined;
}

/**
 * How a bdg command names an element an action was refused for: the index
 * the user gave for a listed element (the selector is then bdg's internal
 * placeholder for the bound node), otherwise the quoted selector. An index
 * that is not a non-negative integer (a malformed IPC request) is not
 * trusted: the quoted selector is used instead.
 *
 * @param target - The element
 * @returns Command argument, e.g. `0` or `'#covered'`
 */
function elementArgument(target: ActedElement): string {
  const { listIndex } = target;
  return Number.isInteger(listIndex) && (listIndex ?? -1) >= 0
    ? String(listIndex)
    : shellQuote(target.selector);
}

/**
 * A mouse press refused under `--strict` because it did not reach the
 * element: it was sent, but landed on another element, or the page never
 * saw it (a browser dialog or bubble captured the input).
 *
 * @param target - Selector and element description, as the click located it, and the index the user gave for a listed element
 * @param verb - What was refused, e.g. "click"
 * @param landedOn - The element the press landed on, when the page saw it
 * @returns Message, and how to inspect the page
 */
export function pressNotReceivedError(
  target: ActedElement,
  verb: string,
  landedOn?: string
): ErrorWithSuggestion {
  const element = target.element ?? target.selector;
  const where =
    landedOn === undefined
      ? 'the page saw no press: the browser may be showing a dialog or bubble that captures input'
      : `landed on ${landedOn}`;
  return {
    message: `Did not ${verb} ${element}: the press did not reach the element (it was sent, but ${where}) (--strict)`,
    suggestion: `Check the page with ${sessionCommand('bdg dom screenshot page.png')} and ${sessionCommand(`bdg dom layout ${elementArgument(target)}`)}`,
  };
}

/**
 * A mouse press refused under `--strict` because the page replaced the
 * element while the mouse was pressed, so it got no click.
 *
 * @param target - Selector and element description, as the click located it
 * @param verb - What was refused, e.g. "click"
 * @returns Message, and how to check what the press did
 */
export function pressTargetReplacedError(target: ActedElement, verb: string): ErrorWithSuggestion {
  const element = target.element ?? target.selector;
  return {
    message: `Did not ${verb} ${element}: the page replaced it while the mouse was pressed, so it got no click (the press was sent) (--strict)`,
    suggestion: `Check what the page did with ${sessionCommand('bdg dom screenshot page.png')}, and find the element again before acting on it`,
  };
}

/**
 * The command that shows what is in the way of an element a press missed.
 *
 * @param target - Selector, and the index the user gave for a listed element
 * @returns e.g. `bdg dom layout 6`
 */
export function layoutNextStep(target: ActedElement): string {
  return sessionCommand(`bdg dom layout ${elementArgument(target)}`);
}

/**
 * `dom fill` refused a value longer than the field's `maxlength` (typing
 * would cut it). The length of a secret field's value is not given.
 *
 * @param maxLength - The field's maxlength
 * @param length - Length of the value given, or undefined for a secret field
 * @returns Error with suggestion
 */
export function fillTooLongError(
  maxLength: number,
  length: number | undefined
): ErrorWithSuggestion {
  return {
    message:
      length === undefined
        ? `The value is longer than the field accepts (at most ${maxLength} characters)`
        : `Value is ${length} characters; the field accepts at most ${maxLength}`,
    suggestion: 'Shorten the value (a user could not type more than maxlength characters)',
  };
}

/**
 * `dom fill` typed the text, but the page had moved the focus and it went
 * to another field (named, never with the text).
 *
 * @param target - The field filled: its selector, its description
 *   (e.g. `input#password "Password"`) when known, and the index the user
 *   gave for a listed element
 * @param receiver - The field that got the text instead
 * @returns Error with suggestion
 */
export function textTypedElsewhereError(
  target: ActedElement,
  receiver: string
): ErrorWithSuggestion {
  const field = target.element ?? target.selector;
  return {
    message: `Did not fill ${field}: the page moved the focus to ${receiver} as bdg typed the text, so ${receiver} got it instead`,
    suggestion: `Clear ${receiver} if it should not keep the text, and see what moves the focus (focus, beforeinput) with ${sessionCommand(`bdg dom listeners ${elementArgument(target)}`)}`,
  };
}

/**
 * Added to the suggestion of a field the page emptied after the fill (#892):
 * a search box may submit by itself and then clear the field
 */
const LATE_CLEARED_HINT =
  '; if the page clears the field after an automatic submit (a search box), the fill may still have taken effect';

/**
 * A fill whose value the page did not keep (#867, exit 90): the read-back
 * differs from the value given. The message names the field (the index and
 * its list, or the selector, and the element) and gives the read-back
 * ({@link valueMismatchWarning}); the suggestion fits how it differs: cut to
 * maxlength, moved to another field, or changed (a secret field's values
 * never shown); a field emptied after the fill (`late`) may have been
 * submitted by the page.
 *
 * @param target - Selector and element description of the filled field, the index the user gave for a listed element, and that index in words with its list (e.g. `index 0 of the last dom query "input"`)
 * @param mismatch - Value given and value found (masked for secret fields)
 * @returns Error with a suggestion
 */
export function valueMismatchError(
  target: ActedElement & { indexText?: string | undefined },
  mismatch: FillValueMismatch
): ErrorWithSuggestion {
  const element = elementArgument(target);
  const field = `${target.indexText ?? element}${target.element ? ` (${target.element})` : ''}`;
  const readBack = valueMismatchWarning(mismatch);
  const suggestion =
    mismatch.truncatedTo !== undefined
      ? `Fill at most ${mismatch.truncatedTo} characters, the field's maxlength`
      : mismatch.movedTo !== undefined
        ? `Fill ${mismatch.movedTo} if the value belongs there; see what moves it with ${sessionCommand(`bdg dom listeners ${element}`)}`
        : `Check the format the field accepts (${sessionCommand(`bdg dom get ${element}`)} shows the field${mismatch.masked ? ', its value masked' : ''}), then fill a value it keeps${mismatch.late && mismatch.actual === '' ? LATE_CLEARED_HINT : ''}`;
  return {
    message: `Fill ${field}: ${readBack.charAt(0).toLowerCase()}${readBack.slice(1)}`,
    suggestion,
  };
}

/**
 * Key press failed (not in the page's script: sending the key events, or the
 * connection).
 *
 * @param cause - What failed, e.g. the error's message
 * @returns Error carrying the cause in its message
 */
export function keyPressFailedError(cause: string): ErrorWithSuggestion {
  return {
    message: `Failed to press key: ${cause}`,
    suggestion: `Check that the page is still open with ${sessionCommand('bdg status')}, then retry`,
  };
}

/**
 * No forms on the page.
 *
 * @param readyState - The page's `document.readyState`, when known
 * @param closedShadowHosts - Components whose closed shadow roots hold form fields
 * @returns Message and suggestion (the still-loading hint while the page
 *   loads; what bdg cannot see when fields are in closed shadow roots)
 */
export function noFormsFoundError(
  readyState?: string,
  closedShadowHosts: string[] = []
): ErrorWithSuggestion {
  const check = joinLines(
    ...closedShadowHosts.map(closedShadowRootMessage),
    'Check if forms exist with: bdg dom query "form, input, [role=textbox]" or inspect the page manually'
  );
  if (readyState === undefined || readyState === 'complete') {
    return { message: 'No forms discovered on the page', suggestion: check };
  }
  return {
    message: 'No forms discovered on the page yet; it is still loading',
    suggestion: joinLines(pageStillLoadingHint(readyState), check),
  };
}

/**
 * The form discovery script threw.
 *
 * @param detail - What it threw, e.g. `TypeError: Cannot read properties of null`
 * @param readyState - The page's `document.readyState`, when known
 * @returns Message and suggestion (the still-loading hint while the page loads)
 */
export function formDiscoveryFailedError(detail: string, readyState?: string): ErrorWithSuggestion {
  if (readyState !== undefined && readyState !== 'complete') {
    return {
      message: `Form discovery failed while the page is still loading (${detail})`,
      suggestion: pageStillLoadingHint(readyState),
    };
  }
  return {
    message: `Form discovery failed: ${detail}`,
    suggestion: `The page changed or threw while it was read; retry, or look at the fields with ${sessionCommand('bdg dom query "form, input, select, textarea"')}`,
  };
}

/**
 * Form in iframe (cross-origin or same-origin).
 */
export function formInIframeError(iframeUrl: string, crossOrigin: boolean): ErrorWithSuggestion {
  return {
    message: `${crossOrigin ? 'The form may be' : 'The form is'} inside an iframe: ${iframeUrl}`,
    suggestion: crossOrigin
      ? 'Cross-origin iframes cannot be read or controlled; open the iframe URL directly: bdg <iframe url>'
      : 'dom form lists forms of the main document only; its fields are reachable directly: bdg dom query "input, select, textarea", then bdg dom fill <index> <value>',
  };
}
