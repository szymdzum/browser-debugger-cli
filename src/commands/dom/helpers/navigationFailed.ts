/**
 * An action whose navigation ended on Chrome's error page (#873) fails with
 * exit 80, as `bdg <url>` and `page navigate` do for a failed load (#860).
 */

import type { CommandResult } from '@/commands/shared/CommandRunner.js';
import type { ActionEffects } from '@/ipc/protocol/domTypes.js';

/**
 * Fail an action whose navigation ended on Chrome's error page: exit 80
 * (INVALID_URL) with the error naming the URL and Chrome's network error;
 * the action's data stays (`navigationFailed` and every other field), and
 * its `warning` moves to the result's.
 *
 * @param result - Result of the action
 * @returns The result, or the failure for a failed navigation
 */
export function failOnNavigationFailed<T extends ActionEffects & { warning?: string | undefined }>(
  result: CommandResult<T>
): CommandResult<T> {
  void result;
  throw new Error('not implemented');
}
