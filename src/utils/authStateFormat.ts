/**
 * The state file format of `bdg state save` / `bdg state load` /
 * `bdg <url> --state`: building, validating and summarizing it.
 *
 * Validation errors name the field at fault, never a value from the file
 * (values are secrets).
 */

import { CommandError } from '@/errors/index.js';
import {
  STATE_FILE_VERSION,
  type AuthStateContent,
  type AuthStateFile,
  type OriginStorage,
  type SkippedOrigin,
  type StateCookie,
  type StateSummary,
} from '@/ipc/protocol/stateTypes.js';
import {
  invalidStateFileError,
  unsupportedStateVersionError,
} from '@/ui/messages/stateMessages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** Values CDP accepts for the cookie fields that are enumerations */
const COOKIE_ENUMS: Record<string, readonly string[]> = {
  sameSite: ['Strict', 'Lax', 'None'],
  priority: ['Low', 'Medium', 'High'],
  sourceScheme: ['Unset', 'NonSecure', 'Secure'],
};

/** Cookie fields that must be booleans when present */
const COOKIE_BOOLEANS = ['httpOnly', 'secure', 'session'];

/** Cookie fields that must be strings */
const COOKIE_STRINGS = ['name', 'value', 'domain', 'path'];

/**
 * The origin of an http(s) URL.
 *
 * @param value - URL or origin
 * @returns Its origin, or undefined for anything else (opaque origins included)
 */
export function httpOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A state file for what was read from the session.
 *
 * @param content - Cookies and origins
 * @param now - When it is saved
 * @returns File contents
 */
export function buildStateFile(content: AuthStateContent, now = new Date()): AuthStateFile {
  return { version: STATE_FILE_VERSION, savedAt: now.toISOString(), ...content };
}

/**
 * Counts of a state, without values.
 *
 * @param content - Cookies and origins
 * @param skipped - Origins left out
 * @returns Summary
 */
export function summarizeState(content: AuthStateContent, skipped?: SkippedOrigin[]): StateSummary {
  return {
    cookies: content.cookies.length,
    origins: content.origins.map((o) => ({
      origin: o.origin,
      localStorage: Object.keys(o.localStorage).length,
      sessionStorage: Object.keys(o.sessionStorage).length,
    })),
    ...(skipped?.length && { skipped }),
  };
}

/**
 * Whether a value is a plain object (not an array or null).
 *
 * @param value - Value
 * @returns True for an object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What is wrong with a cookie, if anything.
 *
 * @param cookie - Cookie from the file
 * @returns Problem (the field, never its value), or undefined
 */
function cookieProblem(cookie: unknown): string | undefined {
  if (!isRecord(cookie)) return 'is not an object';
  const missing = COOKIE_STRINGS.find((field) => typeof cookie[field] !== 'string');
  if (missing) return `${missing} must be a string`;
  const notBoolean = COOKIE_BOOLEANS.find(
    (field) => cookie[field] !== undefined && typeof cookie[field] !== 'boolean'
  );
  if (notBoolean) return `${notBoolean} must be true or false`;
  if (cookie['expires'] !== undefined && typeof cookie['expires'] !== 'number') {
    return 'expires must be a number';
  }
  if (cookie['sourcePort'] !== undefined && !Number.isInteger(cookie['sourcePort'])) {
    return 'sourcePort must be an integer';
  }
  for (const [field, values] of Object.entries(COOKIE_ENUMS)) {
    const value = cookie[field];
    if (value !== undefined && !values.includes(value as string)) {
      return `${field} must be one of ${values.join(', ')}`;
    }
  }
  return undefined;
}

/**
 * Validate a storage map.
 *
 * @param value - `localStorage` or `sessionStorage` from the file
 * @returns Items, or undefined when it is not a map of strings
 */
function storageItems(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return {};
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Validate one origin entry.
 *
 * @param entry - Entry from the file
 * @returns The entry, or the problem (never a value)
 */
function originEntry(entry: unknown): OriginStorage | string {
  if (!isRecord(entry)) return 'is not an object';
  const origin = typeof entry['origin'] === 'string' ? httpOrigin(entry['origin']) : undefined;
  if (origin === undefined || origin !== entry['origin']) {
    return 'origin must be an http(s) origin like https://example.com';
  }
  const localStorage = storageItems(entry['localStorage']);
  if (!localStorage) return 'localStorage must be an object of string values';
  const sessionStorage = storageItems(entry['sessionStorage']);
  if (!sessionStorage) return 'sessionStorage must be an object of string values';
  return { origin, localStorage, sessionStorage };
}

/**
 * Throw the error of an invalid file.
 *
 * @param file - Path given
 * @param reason - What is wrong
 * @throws CommandError (81)
 */
function invalid(file: string, reason: string): never {
  const err = invalidStateFileError(file, reason);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Validate the cookies of a state file.
 *
 * @param file - Path given (for errors)
 * @param value - `cookies` from the file
 * @returns Cookies
 * @throws CommandError (81) naming the first bad cookie and field
 */
function parseCookies(file: string, value: unknown): StateCookie[] {
  if (!Array.isArray(value)) invalid(file, 'cookies must be an array');
  value.forEach((cookie, index) => {
    const problem = cookieProblem(cookie);
    if (problem) invalid(file, `cookies[${index}]: ${problem}`);
  });
  return value as StateCookie[];
}

/**
 * Validate the origins of a state file.
 *
 * @param file - Path given (for errors)
 * @param value - `origins` from the file
 * @returns Origins
 * @throws CommandError (81) naming the first bad entry and field
 */
function parseOrigins(file: string, value: unknown): OriginStorage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(file, 'origins must be an array');
  return value.map((entry, index) => {
    const parsed = originEntry(entry);
    if (typeof parsed === 'string') invalid(file, `origins[${index}]: ${parsed}`);
    return parsed;
  });
}

/**
 * Parse and validate the text of a state file.
 *
 * @param text - File contents
 * @param file - Path given (for errors)
 * @returns Cookies and origins
 * @throws CommandError (81) for invalid JSON, another version or a bad field
 */
export function parseStateFile(text: string, file: string): AuthStateContent {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    invalid(file, 'it is not valid JSON');
  }
  if (!isRecord(data)) invalid(file, 'it is not a JSON object');
  if (data['version'] === undefined) invalid(file, 'it has no version (not a bdg state file)');
  if (typeof data['version'] !== 'number') {
    invalid(file, `version must be the number ${STATE_FILE_VERSION}`);
  }
  if (data['version'] !== STATE_FILE_VERSION) {
    const err = unsupportedStateVersionError(file, data['version'], STATE_FILE_VERSION);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return {
    cookies: parseCookies(file, data['cookies']),
    origins: parseOrigins(file, data['origins']),
  };
}
