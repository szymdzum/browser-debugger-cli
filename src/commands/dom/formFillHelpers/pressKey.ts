/**
 * Key press on a focused element — focuses the element, then dispatches
 * CDP Input.dispatchKeyEvent pairs plus synthetic browser-level events
 * that CDP skips (keypress / input / change / submit).
 */

import { escapeSelectorForJS } from '@/commands/dom/formFillHelpers/shared.js';
import { getKeyDefinition, parseModifiers, type KeyDefinition } from '@/commands/dom/keyMapping.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/ui/errors/index.js';
import { keyPressFailedError, operationFailedError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for pressing a key on an element.
 */
export interface PressKeyOptions {
  index?: number;
  times?: number;
  modifiers?: string;
}

/**
 * Result of pressing a key.
 */
export interface PressKeyResult {
  success: boolean;
  error?: string;
  selector?: string;
  key?: string;
  times?: number;
  modifiers?: number;
  elementType?: string | undefined;
  suggestion?: string;
}

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
 * Press a key on an element. Focuses first, then dispatches a keyDown,
 * synthetic events (so frameworks react), and a keyUp. Repeats `times`
 * times with the given modifiers.
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
      await dispatchSyntheticKeyEvents(cdp, keyDef, modifierFlags);
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

async function dispatchKeyEvent(
  cdp: CDPConnection,
  type: 'keyDown' | 'keyUp',
  keyDef: KeyDefinition,
  modifiers: number
): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type,
    code: keyDef.code,
    key: keyDef.key,
    windowsVirtualKeyCode: keyDef.keyCode,
    nativeVirtualKeyCode: keyDef.keyCode,
    modifiers,
  });
}

/**
 * Fire keypress/input/change/submit events at the element level. CDP's
 * Input.dispatchKeyEvent only fires browser-level keydown/keyup, which
 * misses the events many frameworks actually listen for.
 */
async function dispatchSyntheticKeyEvents(
  cdp: CDPConnection,
  keyDef: KeyDefinition,
  modifiers: number
): Promise<void> {
  const isEnterKey = keyDef.key === 'Enter';
  const script = `
(function() {
  const el = document.activeElement;
  if (!el) return;

  el.dispatchEvent(new KeyboardEvent('keypress', {
    key: '${keyDef.key}',
    code: '${keyDef.code}',
    keyCode: ${keyDef.keyCode},
    charCode: ${keyDef.keyCode},
    which: ${keyDef.keyCode},
    shiftKey: ${Boolean(modifiers & 1)},
    ctrlKey: ${Boolean(modifiers & 2)},
    altKey: ${Boolean(modifiers & 4)},
    metaKey: ${Boolean(modifiers & 8)},
    bubbles: true,
    cancelable: true
  }));

  const tagName = el.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (${isEnterKey} && (tagName === 'INPUT' || tagName === 'TEXTAREA')) {
    const form = el.closest('form');
    if (form) {
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
      const shouldSubmit = form.dispatchEvent(submitEvent);

      if (shouldSubmit) {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
      }
    }
  }
})()
`;
  await cdp.send('Runtime.evaluate', { expression: script });
}
