/**
 * Chrome profile preferences writer.
 *
 * Chrome reads `<user-data-dir>/Default/Preferences` as nested JSON and looks
 * preferences up by path (`profile.password_manager_enabled` is
 * `{"profile": {"password_manager_enabled": ...}}`). bdg's preferences use
 * dotted names, so they are expanded into that structure and deep-merged into
 * the existing file: persistent profiles reused across sessions get them too,
 * and everything else Chrome stored there is kept.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Logger } from '@/connection/types.js';
import { chromePrefsNotAppliedMessage } from '@/ui/messages/chrome.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive } from '@/utils/process.js';

/** JSON object as stored in the Preferences file */
type PrefsObject = Record<string, unknown>;

/**
 * Whether a value is a plain JSON object (not an array or null).
 *
 * @param value - Value to check
 * @returns True for objects that can be merged into
 */
function isPrefsObject(value: unknown): value is PrefsObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Set a preference at a nested path, merging objects with what is there.
 *
 * @param target - Preferences object to modify
 * @param keys - Path segments, e.g. `['profile', 'exit_type']`
 * @param value - Value to set
 */
function setAtPath(target: PrefsObject, keys: string[], value: unknown): void {
  const [key, ...rest] = keys;
  if (key === undefined) return;
  const current = target[key];
  if (rest.length > 0) {
    const child = isPrefsObject(current) ? current : {};
    target[key] = child;
    setAtPath(child, rest, value);
    return;
  }
  if (isPrefsObject(current) && isPrefsObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      setAtPath(current, [childKey], childValue);
    }
    return;
  }
  target[key] = value;
}

/**
 * Merge preferences into an existing Preferences object.
 *
 * Dotted names become nested paths, and a literal dotted top-level key (as
 * earlier bdg versions wrote, which Chrome ignored) is removed.
 *
 * @param existing - Current Preferences content
 * @param prefs - Preferences to apply, dotted or nested
 * @returns Merged Preferences (a new object; `existing` is not modified)
 */
export function mergePreferences(existing: PrefsObject, prefs: PrefsObject): PrefsObject {
  const merged = structuredClone(existing);
  for (const [name, value] of Object.entries(prefs)) {
    if (name.includes('.')) delete merged[name];
    setAtPath(merged, name.split('.'), value);
  }
  return merged;
}

/**
 * Read the profile's Preferences file.
 *
 * @param file - Preferences file path
 * @returns Its content, `{}` if missing
 * @throws Error if it is not valid JSON or not a JSON object
 */
function readPreferencesFile(file: string): PrefsObject {
  if (!fs.existsSync(file)) return {};
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isPrefsObject(parsed)) throw new Error('not a JSON object');
  return parsed;
}

/**
 * Whether a running Chrome has the profile open, judged by its
 * `SingletonLock` symlink (`<host>-<pid>`, macOS and Linux).
 *
 * @param userDataDir - Chrome user data directory
 * @returns True if the lock names a live process on this host
 */
export function profileInUse(userDataDir: string): boolean {
  let target: string;
  try {
    target = fs.readlinkSync(path.join(userDataDir, 'SingletonLock'));
  } catch {
    return false;
  }
  const separator = target.lastIndexOf('-');
  const pid = Number(target.slice(separator + 1));
  return (
    target.slice(0, separator) === os.hostname() && Number.isInteger(pid) && isProcessAlive(pid)
  );
}

/**
 * Replace a file atomically: write a temporary file next to it, then rename.
 *
 * @param file - File to replace
 * @param content - New content
 */
function writeFileAtomic(file: string, content: string): void {
  const temp = `${file}.bdg-${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, content, 'utf8');
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/**
 * Apply preferences to the default profile in a Chrome user data directory.
 *
 * Failures are logged (visible in daemon.log), not thrown: Chrome still
 * starts, only without them. An unreadable Preferences file and a profile
 * that a running Chrome has open are left alone, and the file is not
 * rewritten when nothing changes.
 *
 * @param userDataDir - Chrome user data directory
 * @param prefs - Preferences to apply, dotted or nested
 * @param logger - Logger for failures
 */
export function writeProfilePreferences(
  userDataDir: string,
  prefs: PrefsObject,
  logger: Logger
): void {
  const file = path.join(userDataDir, 'Default', 'Preferences');
  if (profileInUse(userDataDir)) {
    logger.info(chromePrefsNotAppliedMessage(file, 'the profile is in use by a running Chrome'));
    return;
  }
  try {
    const existing = readPreferencesFile(file);
    const content = JSON.stringify(mergePreferences(existing, prefs));
    if (content === JSON.stringify(existing)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, content);
  } catch (error) {
    logger.info(chromePrefsNotAppliedMessage(file, getErrorMessage(error)));
  }
}
