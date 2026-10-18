/**
 * Network error messages.
 */

import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { shellWord, type ErrorWithSuggestion } from './shared.js';

/** Hint for a `url:` filter that matched nothing while some shown URLs are masked */
export const MASKED_URL_FILTER_HINT =
  'url: matches the URL as shown; masked values match only with --include-sensitive';

/**
 * Hint for a `url:` pattern with a `*` that matched nothing.
 *
 * @param value - The `url:` value as written (has a `*`, not at both ends)
 * @returns What the `*` implies, and the pattern to try
 */
export function wildcardUrlFilterHint(value: string): string {
  const inner = value.replace(/^\*+|\*+$/g, '');
  return `With *, url: must match the whole URL; try ${shellWord(`url:*${inner}*`)}`;
}

/**
 * `bdg peek --interval` without `--follow`.
 *
 * @returns Message and suggestion
 */
export function intervalWithoutFollowError(): ErrorWithSuggestion {
  return {
    message: '--interval sets how often --follow refreshes',
    suggestion: 'Add --follow, e.g. bdg peek --follow --interval 500',
  };
}

/**
 * `network details <id> --body` on a request without a response body to print.
 *
 * @param requestId - Request id
 * @param reason - Why there is none (from missingBodyReason)
 * @returns Error with what to do instead
 */
export function responseBodyMissingError(requestId: string, reason: string): ErrorWithSuggestion {
  return {
    message: `No response body for request ${requestId}: ${reason}`,
    suggestion: `Repeat the request (reload the page) to capture it again; ${sessionCommand(`bdg network details ${requestId}`)} shows the rest`,
  };
}

/**
 * A details command given an unknown type or an empty id.
 *
 * @param error - What is wrong
 * @returns Error with the usage of `network details` and `console details`
 */
export function detailsUsageError(error: string): ErrorWithSuggestion {
  return {
    message: error,
    suggestion: 'Usage: bdg network details <requestId> or bdg console details <index>',
  };
}

/**
 * A `details` option that applies to network requests only.
 *
 * @param flag - The option
 * @returns Error with the usage
 */
export function networkOnlyDetailsOptionError(flag: string): ErrorWithSuggestion {
  return {
    message: `${flag} applies to network requests only`,
    suggestion: `Usage: bdg network details <requestId> ${flag}`,
  };
}
