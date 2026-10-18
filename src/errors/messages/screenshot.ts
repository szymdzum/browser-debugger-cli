/**
 * Screenshot error messages.
 */

import * as path from 'path';

import { type ErrorWithSuggestion } from './shared.js';

/**
 * A file the user asked for (screenshot, HAR) cannot be written.
 *
 * @param filePath - Path as given
 * @param reason - What is wrong with it
 * @param extension - Extension of the file kind, for the example (default .png)
 */
export function outputFileError(
  filePath: string,
  reason: string,
  extension = '.png'
): ErrorWithSuggestion {
  const example = `output${path.extname(filePath) || extension}`;
  return {
    message: `Cannot write ${filePath}: ${reason}`,
    suggestion: `Choose a writable file path, e.g. ./${example} or /tmp/${example}`,
  };
}

/**
 * An empty output path.
 *
 * @param extension - Extension of the file kind, for the example
 */
export function emptyOutputPathError(extension = '.png'): ErrorWithSuggestion {
  return {
    message: 'The output path is empty',
    suggestion: `Give a file name, e.g. output${extension}`,
  };
}
