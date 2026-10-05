/**
 * Runtime hint message generators.
 *
 * Boundary formatter for structured `HintDetails` DTOs the session emits
 * alongside CDP command results. Keeps hint wording out of core so the
 * session stays free of UI imports.
 */

import type { HintDetails } from '@/errors/notices.js';
import { joinLines } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Format a structured hint into a user-facing string.
 *
 * Called at the UI boundary (CLI command layer) when a `HintDetails`
 * payload arrives from the daemon. Core emits the DTO; this is the
 * only place hint prose is assembled.
 */
export function formatHint(hint: HintDetails): string {
  const ctx = hint.context ?? {};
  switch (hint.code) {
    case 'PATTERN_HINT': {
      const alternative = ctx['alternative'] as string;
      const cdpMethods = (ctx['cdpMethods'] as string[] | undefined) ?? [];
      return joinLines(
        '',
        `Hint: Consider using '${sessionCommand(alternative)}' instead of ${cdpMethods.join(' or ')}`,
        ''
      );
    }
  }
}
