/**
 * Key press on a focused element — focuses the element, then dispatches
 * CDP Input.dispatchKeyEvent pairs plus synthetic browser-level events
 * that CDP skips (keypress / input / change / submit).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { keyPressFailedError, operationFailedError } from '@/errors/messages.js';
import type { PressKeyResult } from '@/ipc/protocol/domTypes.js';
import { escapeSelectorForJS } from '@/runtime/dom/formFillHelpers/shared.js';
import {
  getKeyDefinition,
  MODIFIER_FLAGS,
  parseModifiers,
  type KeyDefinition,
} from '@/runtime/dom/keyMapping.js';
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

  el.focus();

  return {
    success: true,
    selector: selector,
    elementType: el.tagName.toLowerCase(),
    focused: document.activeElement === el
  };
})`;

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
    return {
      success: false,
      error: `Unknown key: "${keyName}". Supported keys: Enter, Tab, Escape, Space, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12, a-z, 0-9`,
    };
  }

  const times = options.times ?? 1;
  const modifierFlags = parseModifiers(options.modifiers);
  const indexArg = options.index ?? 'null';
  const focusExpression = `(${FOCUS_ELEMENT_SCRIPT})('${escapeSelectorForJS(selector)}', ${indexArg})`;

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
      const err = keyPressFailedError(`focus: ${focusCdpResponse.exceptionDetails.text}`);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.SOFTWARE_ERROR
      );
    }

    const focusResult = focusCdpResponse.result?.value as {
      success: boolean;
      error?: string;
      elementType?: string;
    };

    if (!focusResult?.success) {
      return {
        success: false,
        error: focusResult?.error ?? 'Failed to focus element',
        selector,
      };
    }

    for (let i = 0; i < times; i++) {
      await dispatchKeyEvent(cdp, 'keyDown', keyDef, modifierFlags);
      await dispatchKeyEvent(cdp, 'keyUp', keyDef, modifierFlags);
    }

    return {
      success: true,
      selector,
      key: keyName,
      times,
      modifiers: modifierFlags,
      elementType: focusResult.elementType,
    };
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
 * keypress/input and default action); without text as `rawKeyDown`.
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
  await cdp.send('Input.dispatchKeyEvent', {
    type: type === 'keyDown' && !text ? 'rawKeyDown' : type,
    code: keyDef.code,
    key,
    windowsVirtualKeyCode: keyDef.keyCode,
    modifiers,
    ...(type === 'keyDown' && text && { text, unmodifiedText: keyDef.text }),
  });
}
