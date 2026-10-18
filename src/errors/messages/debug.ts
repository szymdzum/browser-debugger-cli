/**
 * Error messages of logpoints: `bdg debug log|list|hits|clear` (#848).
 */

import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { shellWord, type ErrorWithSuggestion } from './shared.js';

/** Reasons a source map warning lists */
const MAX_REASONS_SHOWN = 3;

/** Most logpoints a session holds */
export const MAX_LOGPOINTS = 10;

/**
 * `bdg debug log` with a location that is not `file:line[:col]`.
 *
 * @param text - Argument as typed
 * @returns Error with an example
 */
export function logpointLocationError(text: string): ErrorWithSuggestion {
  return {
    message: `Not a location: "${text}" (expected file:line, with a 1-based line)`,
    suggestion: 'Example: bdg debug log app.js:5 total discount, or app.js:5:12 for a column',
  };
}

/**
 * A `--page` value other than `all`.
 *
 * @param value - Value as typed
 * @returns Error
 */
export function logpointPageError(value: string): ErrorWithSuggestion {
  return {
    message: `--page takes "all" (got "${value}")`,
    suggestion: 'Without it, hits are those of the page now loaded: bdg debug hits --page all',
  };
}

/**
 * An expression Chrome cannot compile.
 *
 * @param expression - Expression as typed
 * @param reason - Chrome's message
 * @returns Error
 */
export function logpointSyntaxError(expression: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Not a valid JavaScript expression: ${expression} (${reason})`,
    suggestion: 'Give each expression as its own argument, e.g. total "cart.items.length"',
  };
}

/**
 * The limit of logpoints.
 *
 * @returns Error
 */
export function tooManyLogpointsError(): ErrorWithSuggestion {
  return {
    message: `A session holds at most ${MAX_LOGPOINTS} logpoints`,
    suggestion: `Remove one with: ${sessionCommand('bdg debug clear <id>')} (ids: ${sessionCommand('bdg debug list')})`,
  };
}

/**
 * A logpoint at a location that has one.
 *
 * @param id - The existing logpoint
 * @param where - The location
 * @returns Error
 */
export function duplicateLogpointError(id: string, where: string): ErrorWithSuggestion {
  return {
    message: `${id} is already set at ${where}`,
    suggestion: `Replace it: ${sessionCommand(`bdg debug clear ${id}`)} then set it again`,
  };
}

/**
 * No loaded script matches the file: the logpoint waits for one.
 *
 * @param file - File as typed
 * @param similar - Loaded scripts with similar names
 * @param loaded - How many scripts the page has loaded
 * @returns Warning
 */
export function logpointFileNotLoadedWarning(
  file: string,
  similar: string[],
  loaded: number
): string {
  const hint = similar.length
    ? `Did you mean: ${similar.join(', ')}?`
    : `Use the end of a script URL the page loads (see ${sessionCommand('bdg network list')})`;
  return `No loaded script matches "${file}" (${loaded} loaded); the logpoint binds when one does. ${hint}`;
}

/**
 * No loaded script matches the file, and some source maps could not be used.
 *
 * @param file - File as typed
 * @param failures - One reason per map, each naming the map
 * @returns Warning
 */
export function logpointSourceMapWarning(file: string, failures: string[]): string {
  const shown = failures.slice(0, MAX_REASONS_SHOWN).join('; ');
  const more =
    failures.length > MAX_REASONS_SHOWN ? ` (+${failures.length - MAX_REASONS_SHOWN} more)` : '';
  return `No loaded script or readable source map names "${file}"; the logpoint binds when one does. Source maps not used: ${shown}${more}`;
}

/**
 * A source map names the file, but the original line compiles to no code.
 *
 * @param file - File as typed
 * @param line - Line asked for
 * @returns Error
 */
export function logpointNoMappedCodeError(file: string, line: number): ErrorWithSuggestion {
  return {
    message: `${file} has no code at line ${line}`,
    suggestion:
      'The source map has no mapping for this line (a type, an import or a blank line compiles to nothing): pick a line with a statement',
  };
}

/**
 * Two original places that map to the same generated position (Chrome allows
 * one breakpoint there).
 *
 * @param where - The location asked for
 * @returns Error
 */
export function logpointSamePlaceError(where: string): ErrorWithSuggestion {
  return {
    message: `${where} maps to a generated position that already has a breakpoint`,
    suggestion: `See ${sessionCommand('bdg debug list')}; a logpoint or breakpoint at the same compiled place must be cleared first`,
  };
}

/**
 * Source maps a lookup stopped waiting for.
 *
 * @param names - Masked names of the maps (the first few)
 * @param total - How many maps had not answered
 * @returns Reason for a source map warning
 */
export function logpointUnreadMapsReason(names: string[], total: number): string {
  return `${total} source ${total === 1 ? 'map has' : 'maps have'} not answered yet (${names.join(', ')}); the logpoint binds when one names the file`;
}

/**
 * Every generated place of an original line is shared with another statement.
 *
 * @param file - File as typed
 * @param line - Line asked for
 * @returns Error
 */
export function logpointMergedLineError(file: string, line: number): ErrorWithSuggestion {
  return {
    message: `${file}:${line} has no generated place of its own (the compiler merged it into another statement, e.g. after a return)`,
    suggestion:
      'A logpoint there would log the values of another path; set it on the next line, or on the statement that runs first',
  };
}

/**
 * A loaded script that has no code at the line.
 *
 * @param file - File as typed
 * @param line - Line asked for
 * @param lastLine - Last line of the script
 * @returns Error
 */
export function logpointNoCodeError(
  file: string,
  line: number,
  lastLine: number
): ErrorWithSuggestion {
  return {
    message: `${file} has no code at line ${line} (last line ${lastLine})`,
    suggestion: `Pick a line with a statement between 1 and ${lastLine}`,
  };
}

/**
 * An id no logpoint has.
 *
 * @param id - Id as typed
 * @param known - Ids that exist
 * @returns Error
 */
export function logpointNotFoundError(id: string, known: string[]): ErrorWithSuggestion {
  return {
    message: `No logpoint ${shellWord(id)}`,
    suggestion: known.length
      ? `Logpoints: ${known.join(', ')}`
      : `Set one with: ${sessionCommand('bdg debug log <file:line> [expr…]')}`,
  };
}
