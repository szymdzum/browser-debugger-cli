/**
 * Chrome binary resolution and validation.
 *
 * Handles resolving Chrome binary path from options or environment variables,
 * and validates that the binary exists and is executable.
 */

import * as fs from 'fs';

import { ChromeLaunchError } from '@/connection/errors.js';
import { getErrorMessage } from '@/utils/errors.js';

/**
 * Options containing Chrome binary path configuration.
 */
export interface BinaryResolverOptions {
  /** Explicit Chrome binary path (overrides CHROME_PATH env var) */
  chromePath?: string | undefined;
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
    throw new ChromeLaunchError(
      `Chrome binary override (${sourceLabel}) points to "${chromePath}", but that file does not exist.`,
      {
        issue: {
          code: 'CHROME_BINARY_NOT_FOUND',
          context: { chromePath, source: sourceLabel },
        },
      }
    );
  }

  try {
    const stats = fs.statSync(chromePath);
    if (stats.isDirectory()) {
      throw new ChromeLaunchError(
        `Chrome binary override (${sourceLabel}) points to "${chromePath}", which is a directory.`,
        {
          issue: {
            code: 'CHROME_BINARY_IS_DIRECTORY',
            context: { chromePath, source: sourceLabel },
          },
        }
      );
    }

    fs.accessSync(chromePath, fs.constants.X_OK);
  } catch (error) {
    if (error instanceof ChromeLaunchError) {
      throw error;
    }

    throw new ChromeLaunchError(
      `Chrome binary override (${sourceLabel}) points to "${chromePath}", but it is not executable.`,
      {
        ...(error instanceof Error && { cause: error }),
        issue: {
          code: 'CHROME_BINARY_NOT_EXECUTABLE',
          context: { chromePath, source: sourceLabel, reason: getErrorMessage(error) },
        },
      }
    );
  }

  return chromePath;
}
