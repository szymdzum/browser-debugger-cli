/**
 * Chrome preferences loader.
 *
 * Handles loading Chrome preferences from files or inline options,
 * and validates that they are JSON-serializable for chrome-launcher compatibility.
 */

import * as fs from 'fs';

import { ChromeLaunchError, getErrorMessage } from '@/connection/errors.js';
import {
  prefsFileNotFoundError,
  invalidPrefsFormatError,
  prefsLoadError,
} from '@/ui/messages/chrome.js';

/**
 * JSONLike type matching chrome-launcher's internal type definition.
 *
 * Used for Chrome preferences that must be JSON-serializable values.
 * chrome-launcher enforces this constraint to ensure preferences can be
 * safely serialized and passed to Chrome process.
 */
type JSONLike =
  | {
      [property: string]: JSONLike;
    }
  | readonly JSONLike[]
  | string
  | number
  | boolean
  | null;

/**
 * Options for loading Chrome preferences.
 */
export interface PreferencesLoaderOptions {
  /** Path to JSON file containing Chrome preferences */
  prefsFile?: string | undefined;
  /** Inline Chrome preferences object */
  prefs?: Record<string, unknown> | undefined;
}

/**
 * Load Chrome preferences from file or inline options.
 *
 * Supports two modes:
 * 1. **File-based**: Load preferences from JSON file (prefsFile)
 * 2. **Inline**: Use preferences directly from options (prefs)
 *
 * File-based loading takes precedence over inline preferences.
 *
 * @param options - Options containing preferences configuration
 * @returns Preferences object, or undefined if none specified
 * @throws ChromeLaunchError if file doesn't exist, is invalid JSON, or wrong format
 *
 * @example
 * ```typescript
 * // From file
 * const prefs = loadChromePrefs({ prefsFile: './chrome-prefs.json' });
 *
 * // Inline
 * const prefs = loadChromePrefs({
 *   prefs: {
 *     'profile.default_content_settings.popups': 0,
 *     'download.default_directory': '/tmp/downloads'
 *   }
 * });
 * ```
 */
export function loadChromePrefs(
  options: PreferencesLoaderOptions
): Record<string, unknown> | undefined {
  if (options.prefsFile) {
    if (!fs.existsSync(options.prefsFile)) {
      throw new ChromeLaunchError(
        prefsFileNotFoundError(options.prefsFile),
        new Error('File does not exist')
      );
    }

    try {
      const prefsContent = fs.readFileSync(options.prefsFile, 'utf8');
      const parsed: unknown = JSON.parse(prefsContent);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new ChromeLaunchError(
          invalidPrefsFormatError(options.prefsFile, typeof parsed),
          new Error('Invalid JSON structure')
        );
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ChromeLaunchError) {
        throw error;
      }

      throw new ChromeLaunchError(
        prefsLoadError(options.prefsFile, getErrorMessage(error)),
        error instanceof Error ? error : undefined
      );
    }
  }

  return options.prefs;
}

/**
 * Type-safe conversion for Chrome preferences from unknown to JSONLike.
 *
 * chrome-launcher requires preferences to match its internal JSONLike type constraint
 * for type safety. This function validates that preferences are JSON-serializable
 * before casting to ensure runtime safety.
 *
 * @param prefs - Preferences object with unknown values from JSON parsing
 * @returns Preferences compatible with chrome-launcher's JSONLike constraint, or undefined
 * @throws ChromeLaunchError if preferences contain non-JSON-serializable values
 *
 * @example
 * ```typescript
 * const prefs = loadChromePrefs({ prefsFile: './prefs.json' });
 * const compatible = ensureJSONCompatiblePrefs(prefs);
 * // Now safe to pass to chrome-launcher
 * ```
 */
export function ensureJSONCompatiblePrefs(
  prefs: Record<string, unknown> | undefined
): Record<string, JSONLike> | undefined {
  if (prefs === undefined) {
    return undefined;
  }

  try {
    JSON.stringify(prefs);
  } catch (error) {
    throw new ChromeLaunchError(
      `Chrome preferences must be JSON-serializable: ${getErrorMessage(error)}`,
      error instanceof Error ? error : undefined
    );
  }

  return prefs as Record<string, JSONLike>;
}
