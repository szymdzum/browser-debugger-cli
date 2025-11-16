/**
 * Chrome binary resolution and validation.
 *
 * Handles resolving Chrome binary path from options or environment variables,
 * and validates that the binary exists and is executable.
 */

import * as fs from 'fs';

import { getChromeDiagnostics } from '@/connection/diagnostics.js';
import { ChromeLaunchError, getErrorMessage } from '@/connection/errors.js';
import { formatDiagnosticsForError } from '@/ui/messages/chrome.js';
import {
  chromeBinaryOverrideNotFound,
  chromeBinaryOverrideNotExecutable,
  chromeBinaryOverrideIsDirectory,
} from '@/ui/messages/chrome.js';

/**
 * Options containing Chrome binary path configuration.
 */
export interface BinaryResolverOptions {
  /** Explicit Chrome binary path (overrides CHROME_PATH env var) */
  chromePath?: string | undefined;
}

/**
 * Get formatted Chrome diagnostics for error messages.
 *
 * Retrieves Chrome installation information and formats it for display
 * in error messages. Uses cached diagnostics to avoid repeated filesystem scans.
 *
 * @returns Array of formatted diagnostic strings
 */
function getFormattedDiagnostics(): string[] {
  const diagnostics = getChromeDiagnostics();
  return formatDiagnosticsForError(diagnostics);
}

/**
 * Resolve Chrome binary path from options or environment variable.
 *
 * Validates that the resolved binary:
 * - Exists on the filesystem
 * - Is a regular file (not a directory)
 * - Has execute permissions
 *
 * @param options - Configuration with optional chromePath
 * @returns Resolved and validated Chrome binary path, or undefined if not specified
 * @throws ChromeLaunchError if binary path is invalid or not executable
 *
 * @example
 * ```typescript
 * // From options
 * const binary = resolveChromeBinary({ chromePath: '/usr/bin/google-chrome' });
 *
 * // From environment variable
 * process.env['CHROME_PATH'] = '/opt/chrome/chrome';
 * const binary = resolveChromeBinary({});
 *
 * // Not specified (returns undefined, launcher will use default)
 * const binary = resolveChromeBinary({});
 * ```
 */
export function resolveChromeBinary(options: BinaryResolverOptions): string | undefined {
  const override = options.chromePath ?? process.env['CHROME_PATH'];

  if (!override) {
    return undefined;
  }

  const chromePath = override.trim();
  if (!chromePath) {
    return undefined;
  }

  const sourceLabel = options.chromePath ? 'chromePath option' : 'CHROME_PATH';

  if (!fs.existsSync(chromePath)) {
    const diagnostics = getFormattedDiagnostics();
    throw new ChromeLaunchError(
      `${chromeBinaryOverrideNotFound(chromePath, sourceLabel)}\n\n${diagnostics.join('\n')}`
    );
  }

  try {
    const stats = fs.statSync(chromePath);
    if (stats.isDirectory()) {
      throw new ChromeLaunchError(chromeBinaryOverrideIsDirectory(chromePath, sourceLabel));
    }

    fs.accessSync(chromePath, fs.constants.X_OK);
  } catch (error) {
    if (error instanceof ChromeLaunchError) {
      throw error;
    }

    throw new ChromeLaunchError(
      `${chromeBinaryOverrideNotExecutable(chromePath, sourceLabel)}\n\n${getErrorMessage(error)}`,
      error instanceof Error ? error : undefined
    );
  }

  return chromePath;
}
