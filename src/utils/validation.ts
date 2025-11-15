import fs from 'fs';

import { invalidLastArgumentError } from '@/ui/messages/commands.js';
import { invalidIntegerError } from '@/ui/messages/validation.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Parse and validate a positive integer option with range constraints.
 *
 * @param name - The option name for error messages
 * @param value - The string value to parse (or undefined)
 * @param options - Validation configuration
 * @returns Parsed integer value
 * @throws Error if validation fails and exitOnError is false
 *
 * @example
 * ```typescript
 * const lastN = parsePositiveIntOption('last', options.last, {
 *   defaultValue: 10,
 *   min: 1,
 *   max: 1000,
 *   exitOnError: true
 * });
 * ```
 */
export function parsePositiveIntOption(
  name: string,
  value: string | undefined,
  options: {
    defaultValue?: number;
    min?: number;
    max?: number;
    exitOnError?: boolean;
  } = {}
): number {
  const { defaultValue, min, max, exitOnError = false } = options;
  const strValue = value ?? (defaultValue !== undefined ? defaultValue.toString() : undefined);

  if (strValue === undefined) {
    const error = new Error(`Option --${name} is required`);
    if (exitOnError) {
      console.error(error.message);
      process.exit(EXIT_CODES.INVALID_ARGUMENTS);
    }
    throw error;
  }

  const parsed = parseInt(strValue, 10);

  if (isNaN(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    const rangeOptions = min !== undefined && max !== undefined ? { min, max } : undefined;
    const errorMessage =
      name === 'last'
        ? invalidLastArgumentError(value)
        : invalidIntegerError(name, strValue, rangeOptions);

    if (exitOnError) {
      console.error(errorMessage);
      process.exit(EXIT_CODES.INVALID_ARGUMENTS);
    }
    throw new Error(errorMessage);
  }

  return parsed;
}

/**
 * Parse an optional integer option (returns undefined if not provided).
 *
 * @param name - The option name for error messages
 * @param value - The string value to parse (or undefined)
 * @param options - Validation configuration
 * @returns Parsed integer or undefined
 * @throws Error if value is provided but invalid
 *
 * @example
 * ```typescript
 * const timeout = parseOptionalIntOption('timeout', options.timeout, {
 *   min: 1,
 *   max: 3600
 * });
 * ```
 */
export function parseOptionalIntOption(
  name: string,
  value: string | undefined,
  options: {
    min?: number;
    max?: number;
  } = {}
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const { min, max } = options;
  const parsed = parseInt(value, 10);

  if (isNaN(parsed)) {
    const rangeOptions = min !== undefined && max !== undefined ? { min, max } : undefined;
    throw new Error(invalidIntegerError(name, value, rangeOptions));
  }

  if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    const rangeOptions = min !== undefined && max !== undefined ? { min, max } : undefined;
    throw new Error(invalidIntegerError(name, value, rangeOptions));
  }

  return parsed;
}

/**
 * Read and parse a PID from a file.
 *
 * @param filePath - Path to the PID file
 * @returns Parsed PID or null if file doesn't exist or contains invalid data
 *
 * @example
 * ```typescript
 * const daemonPid = readPidFromFile('/path/to/daemon.pid');
 * if (daemonPid && isProcessAlive(daemonPid)) {
 *   console.log('Daemon is running');
 * }
 * ```
 */
export function readPidFromFile(filePath: string): number | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const pidStr = fs.readFileSync(filePath, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);

    if (isNaN(pid)) {
      return null;
    }

    return pid;
  } catch {
    return null;
  }
}
