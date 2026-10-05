/**
 * Key press on a focused element — focuses the element, then dispatches
 * CDP Input.dispatchKeyEvent pairs plus synthetic browser-level events
 * that CDP skips (keypress / input / change / submit).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  VIA_LABEL_SUFFIX,
  keyPressFailedError,
  operationFailedError,
  unknownKeyError,
} from '@/errors/messages.js';
import type { PressKeyResult } from '@/ipc/protocol/domTypes.js';
import { ELEMENT_IDENTITY_JS } from '@/runtime/dom/elementInfo.js';
import {
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  describeModifiers,
  getKeyDefinition,
  impliesShift,
  MODIFIER_FLAGS,
  parseModifiers,
  similarKeyNames,
  shortcutCommands,
  type KeyDefinition,
} from '@/runtime/dom/keyMapping.js';
import { FIND_ELEMENTS_JS, LABEL_CONTROL_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for pressing a key on an element.
 */
export interface PressKeyOptions {
  index?: number;
  times?: number;
  modifiers?: string;
}

export type { PressKeyResult } from '@/ipc/protocol/domTypes.js';

const FOCUS_ELEMENT_SCRIPT = `
(function(selector, parts, index) {
  const allMatches = (${FIND_ELEMENTS_JS})(selector, parts);
  if (allMatches.length === 0) {
    return { success: false, reason: 'not-found', error: 'Element not found: ' + selector };
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
  const labelControl = (${LABEL_CONTROL_JS})(el);
  const viaLabel = labelControl ? ${JSON.stringify(VIA_LABEL_SUFFIX)} : '';
  if (labelControl) el = labelControl;

  const pageLevel = el === document.body || el === document.documentElement;
  if (!pageLevel) {
    const wasFocused = el.getRootNode().activeElement === el;
    el.focus();
    // A user clicking into a field before typing lands at the end of its text
    if (!wasFocused) {
      try {
        if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
          el.setSelectionRange(el.value.length, el.value.length);
        } else if (el.isContentEditable) {
          const range = el.ownerDocument.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          const selection = el.ownerDocument.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } catch (e) {
        // Inputs without a caret (number, email, checkbox) keep theirs
      }
    }
    const focused = el.getRootNode().activeElement;
    if (focused !== el && !el.contains(focused)) {
      return {
        success: false,
        reason: 'not-focusable',
        error: 'Element <' + el.tagName.toLowerCase() + '> cannot receive keyboard focus' + (el.matches(':disabled') ? ' (it is disabled)' : '')
      };
    }
  }

  return {
    success: true,
    selector: selector,
    element: (${ELEMENT_IDENTITY_JS})(el),
    elementType: el.tagName.toLowerCase() + viaLabel,
    matchCount: allMatches.length
  };
})`;

/** Exit codes and suggestions for focus failures, by reason. */
const FOCUS_FAILURES: Record<string, { exitCode: number; suggestion: string }> = {
  'not-found': {
    exitCode: EXIT_CODES.RESOURCE_NOT_FOUND,
    suggestion: 'Verify the selector matches a focusable element',
  },
  range: {
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    suggestion: 'Use an --index within the matches',
  },
  'not-focusable': {
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    suggestion:
      'Target an input, textarea, button, link or [tabindex] element; use "body" for page-level keys like Escape',
  },
};

/**
 * Press a key on an element: focus it, then dispatch a real keyDown/keyUp
 * pair through CDP. Repeats `times` times with the given modifiers.
 *
 * Keys that type text (letters, digits, Space, Enter) carry `text`, so the
 * browser performs the key's default action exactly like a physical key:
 * the character is inserted (with trusted keypress/input events), Enter adds
 * a newline in a textarea or submits the form once from an input, and Tab
 * moves focus. No synthetic events are fired.
 */
export async function pressKeyElement(
  cdp: CDPConnection,
  selector: string,
  keyName: string,
  options: PressKeyOptions = {}
): Promise<PressKeyResult> {
  const keyDef = getKeyDefinition(keyName);
  if (!keyDef) {
    const err = unknownKeyError(keyName, similarKeyNames(keyName));
    return {
      success: false,
      error: err.message,
      suggestion: err.suggestion,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    };
  }

  const times = options.times ?? 1;
  const implicitShift = impliesShift(keyName) ? MODIFIER_FLAGS.shift : 0;
  const modifierFlags = parseModifiers(options.modifiers) | implicitShift;
  const indexArg = options.index ?? 'null';
  const focusExpression = `(${FOCUS_ELEMENT_SCRIPT})(${selectorArgsJS(selector)}, ${indexArg})`;

  try {
    const focusResponse = await cdp.send('Runtime.evaluate', {
      expression: focusExpression,
      returnByValue: true,
    });

    const focusCdpResponse = focusResponse as {
      exceptionDetails?: Protocol.Runtime.ExceptionDetails;
      result?: { value?: unknown };
    };

    if (focusCdpResponse.exceptionDetails) {
      throwIfInvalidSelector(focusCdpResponse.exceptionDetails, selector);
      const err = keyPressFailedError(`focus: ${focusCdpResponse.exceptionDetails.text}`);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    const focusResult = focusCdpResponse.result?.value as {
      success: boolean;
      reason?: string;
      error?: string;
      element?: string;
      elementType?: string;
      matchCount?: number;
    };

    if (!focusResult?.success) {
      const failure = FOCUS_FAILURES[focusResult?.reason ?? ''];
      return {
        success: false,
        error: focusResult?.error ?? 'Failed to focus element',
        selector,
        ...(failure && { exitCode: failure.exitCode, suggestion: failure.suggestion }),
      };
    }

    for (let i = 0; i < times; i++) {
      await dispatchKeyEvent(cdp, 'keyDown', keyDef, modifierFlags);
      await dispatchKeyEvent(cdp, 'keyUp', keyDef, modifierFlags);
    }

    return withMultipleMatchesWarning(
      {
        success: true,
        selector,
        key: keyName,
        times,
        ...(modifierFlags > 0 && { modifiers: describeModifiers(modifierFlags) }),
        ...(focusResult.element !== undefined && { element: focusResult.element }),
        elementType: focusResult.elementType,
        ...(focusResult.matchCount !== undefined && { matchCount: focusResult.matchCount }),
      },
      options.index,
      'pressed the key on the first'
    );
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const err = operationFailedError('press key', errorMessage);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }
}

/**
 * Text a key types with the given modifiers, or undefined for shortcuts and
 * non-text keys.
 *
 * @param keyDef - Key definition
 * @param modifiers - CDP modifier bit flags
 * @returns Text to insert, if any
 */
function keyText(keyDef: KeyDefinition, modifiers: number): string | undefined {
  if (!keyDef.text) return undefined;
  const shortcut = MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.meta | MODIFIER_FLAGS.alt;
  if (modifiers & shortcut) return undefined;
  if (!(modifiers & MODIFIER_FLAGS.shift)) return keyDef.text;
  return keyDef.shiftText ?? keyDef.text.toUpperCase();
}

/**
 * Dispatch one key event through CDP.
 *
 * A keyDown with text is sent as `keyDown` (the browser generates the
 * keypress/input and default action); without text as `rawKeyDown`. Editing
 * shortcuts (Ctrl/Cmd+A, C, X, V, Z) name their editor command.
 *
 * @param cdp - CDP connection
 * @param type - Event phase
 * @param keyDef - Key definition
 * @param modifiers - CDP modifier bit flags
 */
async function dispatchKeyEvent(
  cdp: CDPConnection,
  type: 'keyDown' | 'keyUp',
  keyDef: KeyDefinition,
  modifiers: number
): Promise<void> {
  const text = keyText(keyDef, modifiers);
  const key = text && text !== '\r' ? text : keyDef.key;
  const commands = type === 'keyDown' ? shortcutCommands(keyDef.code, modifiers) : [];
  await cdp.send('Input.dispatchKeyEvent', {
    type: type === 'keyDown' && !text ? 'rawKeyDown' : type,
    code: keyDef.code,
    key,
    windowsVirtualKeyCode: keyDef.keyCode,
    modifiers,
    ...(type === 'keyDown' && text && { text, unmodifiedText: keyDef.text }),
    ...(commands.length > 0 && { commands }),
  });
}
