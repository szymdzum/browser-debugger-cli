/**
 * Key name to CDP key event parameters mapping.
 *
 * Maps human-readable key names to Chrome DevTools Protocol Input.dispatchKeyEvent parameters.
 */

import { findSimilar } from '@/utils/suggestions.js';

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
  /** Text the key types (letters, digits, space, Enter); absent for non-text keys */
  text?: string;
  /** Text typed with Shift on a US layout, when it is not just the uppercased `text` */
  shiftText?: string;
}

/**
 * Modifier key bit flags for CDP Input.dispatchKeyEvent
 * (Alt=1, Ctrl=2, Meta/Command=4, Shift=8).
 */
export const MODIFIER_FLAGS = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
} as const;

/**
 * Map of supported key names to their CDP parameters.
 *
 * Keys are case-insensitive for user convenience.
 */
const KEY_DEFINITIONS: Record<string, KeyDefinition> = {
  enter: { code: 'Enter', key: 'Enter', keyCode: 13, text: '\r' },
  tab: { code: 'Tab', key: 'Tab', keyCode: 9 },
  escape: { code: 'Escape', key: 'Escape', keyCode: 27 },
  space: { code: 'Space', key: ' ', keyCode: 32, text: ' ' },
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
    text: letter,
  };
}

for (let i = 0; i < 10; i++) {
  const digit = String(i);
  KEY_DEFINITIONS[digit] = {
    code: `Digit${digit}`,
    key: digit,
    keyCode: 48 + i, // '0' = 48
    text: digit,
    shiftText: ')!@#$%^&*('.charAt(i),
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
  const name = keyName.toLowerCase();
  const digit = keyName.length === 1 ? SHIFTED_DIGITS.indexOf(keyName) : -1;
  if (digit !== -1) return KEY_DEFINITIONS[String(digit)];
  return KEY_DEFINITIONS[KEY_ALIASES[name] ?? name];
}

/** Other names users write for keys */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  spacebar: 'space',
  ' ': 'space',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pagedn: 'pagedown',
};

/** Characters typed with Shift on the digit keys 0-9 (US layout) */
const SHIFTED_DIGITS = ')!@#$%^&*(';

/**
 * Whether a key name needs Shift to produce it (an uppercase letter, or a
 * symbol on a digit key such as "!").
 *
 * @param keyName - Key name as given
 * @returns True if Shift is implied
 */
export function impliesShift(keyName: string): boolean {
  return /^[A-Z]$/.test(keyName) || (keyName.length === 1 && SHIFTED_DIGITS.includes(keyName));
}

/**
 * Key names closest to an unknown one.
 *
 * @param keyName - Unknown key name
 * @returns Up to three key names, in their usual spelling
 */
export function similarKeyNames(keyName: string): string[] {
  const names = Object.values(KEY_DEFINITIONS)
    .map((definition) => definition.key)
    .filter((key) => key.length > 1);
  return findSimilar(keyName, names);
}

/** Accepted modifier names (and common aliases) mapped to their flag. */
const MODIFIER_NAMES: Record<string, keyof typeof MODIFIER_FLAGS> = {
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  shift: 'shift',
};

/**
 * Split a comma-separated modifier list into lowercase names.
 *
 * @param modifiers - e.g. "Ctrl, shift"
 * @returns Non-empty names
 */
function modifierNames(modifiers: string): string[] {
  return modifiers
    .toLowerCase()
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Names in a modifier list that are not recognized.
 *
 * @param modifiers - Comma-separated modifier names
 * @returns Unknown names (empty when all are valid)
 */
export function findUnknownModifiers(modifiers: string): string[] {
  return modifierNames(modifiers).filter((name) => !(name in MODIFIER_NAMES));
}

/**
 * Parse modifier string into CDP modifier flags.
 *
 * @param modifiers - Comma-separated modifier names (e.g., "ctrl,shift"; aliases cmd, control, option)
 * @returns Combined modifier bit flags
 *
 * @example
 * ```typescript
 * parseModifiers('ctrl,shift'); // Returns 10 (2 + 8)
 * parseModifiers('cmd');        // Returns 4
 * parseModifiers('');           // Returns 0
 * ```
 */
export function parseModifiers(modifiers: string | undefined): number {
  if (!modifiers) return 0;
  return modifierNames(modifiers).reduce((flags, name) => {
    const flag = MODIFIER_NAMES[name];
    return flag ? flags | MODIFIER_FLAGS[flag] : flags;
  }, 0);
}

/**
 * Human-readable names of set modifier flags.
 *
 * @param flags - CDP modifier bit flags
 * @returns e.g. ["Ctrl", "Shift"]
 */
export function describeModifiers(flags: number): string[] {
  const labels: Record<keyof typeof MODIFIER_FLAGS, string> = {
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Meta',
  };
  return (Object.keys(labels) as Array<keyof typeof MODIFIER_FLAGS>)
    .filter((name) => flags & MODIFIER_FLAGS[name])
    .map((name) => labels[name]);
}

/** Editor commands of the standard Ctrl/Cmd shortcuts, by key code */
const SHORTCUT_COMMANDS: Record<string, string> = {
  KeyA: 'selectAll',
  KeyC: 'copy',
  KeyX: 'cut',
  KeyV: 'paste',
  KeyZ: 'undo',
};

/**
 * Editor commands a key press triggers, like a physical keyboard does.
 *
 * Chrome only runs shortcuts such as Ctrl+A (Cmd+A on macOS) for events it
 * gets from the OS; for CDP key events the command has to be named. Either
 * Ctrl or Meta works, so scripts behave the same on every platform; Shift+Z
 * redoes.
 *
 * @param code - Key code, e.g. "KeyA"
 * @param flags - CDP modifier bit flags
 * @returns Editor commands for `Input.dispatchKeyEvent`, empty if none
 */
export function shortcutCommands(code: string, flags: number): string[] {
  const command = SHORTCUT_COMMANDS[code];
  const shortcutModifier = flags & (MODIFIER_FLAGS.ctrl | MODIFIER_FLAGS.meta);
  if (!command || !shortcutModifier || flags & MODIFIER_FLAGS.alt) return [];
  if (command === 'undo' && flags & MODIFIER_FLAGS.shift) return ['redo'];
  return flags & MODIFIER_FLAGS.shift ? [] : [command];
}
