/**
 * Key name to CDP key event parameters mapping.
 *
 * Maps human-readable key names to Chrome DevTools Protocol Input.dispatchKeyEvent parameters.
 */

/**
 * CDP key event parameters for a specific key.
 */
export interface KeyDefinition {
  /** Physical key code (e.g., "Enter", "KeyA") */
  code: string;
  /** Logical key value (e.g., "Enter", "a") */
  key: string;
  /** Windows virtual key code */
  keyCode: number;
}

/**
 * Modifier key bit flags for CDP Input.dispatchKeyEvent.
 */
export const MODIFIER_FLAGS = {
  shift: 1,
  ctrl: 2,
  alt: 4,
  meta: 8,
} as const;

/**
 * Map of supported key names to their CDP parameters.
 *
 * Keys are case-insensitive for user convenience.
 */
const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
  enter: { code: 'Enter', key: 'Enter', keyCode: 13 },
  tab: { code: 'Tab', key: 'Tab', keyCode: 9 },
  escape: { code: 'Escape', key: 'Escape', keyCode: 27 },
  space: { code: 'Space', key: ' ', keyCode: 32 },
  backspace: { code: 'Backspace', key: 'Backspace', keyCode: 8 },
  delete: { code: 'Delete', key: 'Delete', keyCode: 46 },

  arrowup: { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
  arrowdown: { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 },
  arrowleft: { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
  arrowright: { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },

  home: { code: 'Home', key: 'Home', keyCode: 36 },
  end: { code: 'End', key: 'End', keyCode: 35 },
  pageup: { code: 'PageUp', key: 'PageUp', keyCode: 33 },
  pagedown: { code: 'PageDown', key: 'PageDown', keyCode: 34 },

  f1: { code: 'F1', key: 'F1', keyCode: 112 },
  f2: { code: 'F2', key: 'F2', keyCode: 113 },
  f3: { code: 'F3', key: 'F3', keyCode: 114 },
  f4: { code: 'F4', key: 'F4', keyCode: 115 },
  f5: { code: 'F5', key: 'F5', keyCode: 116 },
  f6: { code: 'F6', key: 'F6', keyCode: 117 },
  f7: { code: 'F7', key: 'F7', keyCode: 118 },
  f8: { code: 'F8', key: 'F8', keyCode: 119 },
  f9: { code: 'F9', key: 'F9', keyCode: 120 },
  f10: { code: 'F10', key: 'F10', keyCode: 121 },
  f11: { code: 'F11', key: 'F11', keyCode: 122 },
  f12: { code: 'F12', key: 'F12', keyCode: 123 },
};

for (let i = 0; i < 26; i++) {
  const letter = String.fromCharCode(97 + i); // 'a' = 97
  const upperLetter = letter.toUpperCase();
  KEY_DEFINITIONS[letter] = {
    code: `Key${upperLetter}`,
    key: letter,
    keyCode: 65 + i, // 'A' = 65
  };
}

for (let i = 0; i < 10; i++) {
  const digit = String(i);
  KEY_DEFINITIONS[digit] = {
    code: `Digit${digit}`,
    key: digit,
    keyCode: 48 + i, // '0' = 48
  };
}

/**
 * Get key definition by name (case-insensitive).
 *
 * @param keyName - Human-readable key name (e.g., "Enter", "Tab", "a")
 * @returns Key definition or undefined if not found
 *
 * @example
 * ```typescript
 * const def = getKeyDefinition('Enter');
 * // { code: 'Enter', key: 'Enter', keyCode: 13 }
 *
 * const letterDef = getKeyDefinition('a');
 * // { code: 'KeyA', key: 'a', keyCode: 65 }
 * ```
 */
export function getKeyDefinition(keyName: string): KeyDefinition | undefined {
  return KEY_DEFINITIONS[keyName.toLowerCase()];
}

/**
 * Parse modifier string into CDP modifier flags.
 *
 * @param modifiers - Comma-separated modifier names (e.g., "ctrl,shift")
 * @returns Combined modifier bit flags
 *
 * @example
 * ```typescript
 * parseModifiers('ctrl,shift'); // Returns 3 (1 + 2)
 * parseModifiers('alt');        // Returns 4
 * parseModifiers('');           // Returns 0
 * ```
 */
export function parseModifiers(modifiers: string | undefined): number {
  if (!modifiers) {
    return 0;
  }

  let flags = 0;
  const parts = modifiers.toLowerCase().split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed in MODIFIER_FLAGS) {
      flags |= MODIFIER_FLAGS[trimmed as keyof typeof MODIFIER_FLAGS];
    }
  }

  return flags;
}
