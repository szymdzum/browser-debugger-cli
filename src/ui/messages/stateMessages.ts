/**
 * Messages of saved browser auth state: `bdg state save`, `bdg state load`
 * and `bdg <url> --state`. They print counts and origins, never values.
 */

import type { ErrorWithSuggestion } from '@/errors/messages.js';
import type {
  OriginStorageCounts,
  SkippedOrigin,
  StateSummary,
} from '@/ipc/protocol/stateTypes.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/** Warning in the help of every state option: the file holds secrets */
export const STATE_FILE_WARNING =
  'The file holds secrets (session cookies, tokens in storage): it is written readable by its owner only (0600); keep it out of version control and shared folders';

/** Description of the `state` command group */
export const STATE_DESCRIPTION =
  'Save and load browser auth state: cookies (session and HttpOnly ones included), localStorage and sessionStorage';

/** Description of `bdg state save` */
export const STATE_SAVE_DESCRIPTION =
  "Save the session's cookies and the storage of the page's origins to a JSON file";

/** Description of `bdg state load` */
export const STATE_LOAD_DESCRIPTION =
  "Restore cookies and storage from a file saved by bdg state save, then reload the page (with --chrome-ws-url: into that Chrome's own profile, reloading its tab)";

/** Description of the start option `--state` */
export const START_STATE_OPTION_DESCRIPTION =
  'Load cookies and storage saved by bdg state save before the page first loads (every saved origin is restored)';

/**
 * Why an origin's storage was left out.
 *
 * @param skipped - The origin and the reason
 * @returns Text
 */
function skippedReason(skipped: SkippedOrigin): string {
  if (skipped.reason === 'partitioned') return 'cross-site frame, its storage is partitioned';
  if (skipped.reason === 'upgraded-to-https') {
    return 'Chrome loads it over https (HSTS or HTTPS-First), whose storage is separate';
  }
  return 'no frame of it on the page';
}

/**
 * One line per origin with its item counts.
 *
 * @param origins - Origins
 * @returns Lines
 */
function originLines(origins: OriginStorageCounts[]): string[] {
  return origins.map(
    (o) => `  ${o.origin}: localStorage ${o.localStorage}, sessionStorage ${o.sessionStorage}`
  );
}

/**
 * Lines for the origins left out.
 *
 * @param skipped - Origins left out
 * @returns Lines (none when empty)
 */
function skippedLines(skipped: SkippedOrigin[] | undefined): string[] {
  if (!skipped?.length) return [];
  return ['Skipped:', ...skipped.map((s) => `  ${s.origin} (${skippedReason(s)})`)];
}

/**
 * Counts of a state in a few words: "3 cookies, storage of 2 origins".
 *
 * @param summary - What was saved or restored
 * @returns Text
 */
export function stateCountsText(summary: StateSummary): string {
  const cookies = `${summary.cookies} cookie${summary.cookies === 1 ? '' : 's'}`;
  const n = summary.origins.length;
  return `${cookies}, storage of ${n} origin${n === 1 ? '' : 's'}`;
}

/**
 * Human output of `bdg state save`.
 *
 * @param file - Absolute path written
 * @param summary - What was saved
 * @returns Text
 */
export function stateSavedMessage(file: string, summary: StateSummary): string {
  return [
    `✓ Saved ${stateCountsText(summary)} to ${file}`,
    ...originLines(summary.origins),
    ...skippedLines(summary.skipped),
    `⚠ ${STATE_FILE_WARNING}`,
    `Load it with: bdg <url> --state ${file}, or ${sessionCommand(`bdg state load ${file}`)}`,
  ].join('\n');
}

/**
 * Human output of `bdg state load`.
 *
 * @param summary - What was restored, and the page after the reload
 * @returns Text
 */
export function stateLoadedMessage(summary: StateSummary & { reload?: { url: string } }): string {
  return [
    `✓ Loaded ${stateCountsText(summary)}`,
    ...originLines(summary.origins),
    ...skippedLines(summary.skipped),
    ...(summary.skipped?.some((s) => s.reason === 'not-on-page')
      ? [
          'Storage is restored through a frame of its origin; to restore every origin, start with: bdg <url> --state <file>',
        ]
      : []),
    summary.reload ? `Reloaded: ${summary.reload.url}` : 'Not reloaded (--no-reload)',
  ].join('\n');
}

/**
 * Line of the start output after `--state`.
 *
 * @param summary - What was restored
 * @returns Text
 */
export function startStateLine(summary: StateSummary): string {
  return `State: loaded ${stateCountsText(summary)}`;
}

/**
 * A state file that cannot be read or is not a bdg state file.
 *
 * @param file - Path given
 * @param reason - What is wrong (never a value from the file)
 * @returns Error with suggestion
 */
export function invalidStateFileError(file: string, reason: string): ErrorWithSuggestion {
  return {
    message: `Cannot load state from ${file}: ${reason}`,
    suggestion: `Give a file written by: ${sessionCommand('bdg state save <file>')} (JSON with version, cookies and origins)`,
  };
}

/**
 * A state file of another format version.
 *
 * @param file - Path given
 * @param version - Version in the file
 * @param supported - Version this bdg reads
 * @returns Error with suggestion
 */
export function unsupportedStateVersionError(
  file: string,
  version: number,
  supported: number
): ErrorWithSuggestion {
  return {
    message: `Cannot load state from ${file}: version ${version} is not supported (this bdg reads version ${supported})`,
    suggestion: `Save it again with this bdg: ${sessionCommand('bdg state save <file>')}`,
  };
}

/**
 * `--origin` that is not an http(s) origin.
 *
 * @param value - What was given
 * @returns Error with suggestion
 */
export function invalidStateOriginError(value: string): ErrorWithSuggestion {
  return {
    message: `Invalid --origin: "${value}" is not an http(s) URL`,
    suggestion: 'Give an origin or any URL of it, e.g. --origin https://app.example.com',
  };
}

/**
 * `--origin` naming an origin the page has no frame of.
 *
 * @param origins - Origins asked for that are not on the page
 * @param onPage - Origins the page has frames of
 * @returns Error with suggestion
 */
export function stateOriginNotOnPageError(
  origins: string[],
  onPage: string[]
): ErrorWithSuggestion {
  const listed = onPage.length ? onPage.join(', ') : 'none';
  return {
    message: `No frame of ${origins.join(', ')} on the page: storage is read through a frame of its origin (origins on the page: ${listed})`,
    suggestion: `Open a page of that origin first (${sessionCommand('bdg page navigate <url>')}) and save again, or leave out --origin to save the origins on the page`,
  };
}

/**
 * `--state` given with `--chrome-ws-url`: restoring before the first load
 * would walk the user's own tab through the saved origins, clear its
 * history and write into their profile.
 *
 * @param file - The state file given
 * @returns Error with suggestion
 */
export function stateWithChromeWsUrlError(file: string): ErrorWithSuggestion {
  return {
    message:
      '--state cannot be used with --chrome-ws-url (restoring before the first load would navigate your own tab through the saved origins and clear its history)',
    suggestion: `Start without --chrome-ws-url to restore it into bdg's own Chrome, or attach first and run: ${sessionCommand(`bdg state load ${file}`)} (it writes into that Chrome's profile and reloads the tab)`,
  };
}

/**
 * Chrome refused the cookies of a state file.
 *
 * @param reason - Chrome's error
 * @returns Error with suggestion
 */
export function stateCookiesRefusedError(reason: string): ErrorWithSuggestion {
  return {
    message: `Chrome refused the cookies of the state file: ${reason}`,
    suggestion: `Save the state again with: ${sessionCommand('bdg state save <file>')}`,
  };
}
