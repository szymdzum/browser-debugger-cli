/**
 * Release of per-call CDP object groups (#606).
 *
 * Every command that resolves page objects names an object group of its own
 * and releases it when done. A release is housekeeping: it must never replace
 * the command's own result or error, nor stall it on a page that does not
 * answer.
 */

import { createLogger } from '@/ui/logging/index.js';
import { withTimeout } from '@/utils/async.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** How long a release may take before the caller goes on without it */
export const OBJECT_GROUP_RELEASE_TIMEOUT_MS = 2000;

/** Sends a CDP call to the page that holds the group */
export interface ObjectGroupSender {
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Release an object group best-effort: never throws, logs a failure at debug
 * level, and gives up after `timeoutMs`.
 *
 * @param page - Connection to the page holding the group
 * @param objectGroup - The group
 * @param timeoutMs - Longest wait for the page's answer
 * @returns Whether the page confirmed the release
 */
export async function releaseObjectGroup(
  page: ObjectGroupSender,
  objectGroup: string,
  timeoutMs: number = OBJECT_GROUP_RELEASE_TIMEOUT_MS
): Promise<boolean> {
  try {
    const release = Promise.resolve().then(() =>
      page.send('Runtime.releaseObjectGroup', { objectGroup })
    );
    await withTimeout(release, timeoutMs, 'Runtime.releaseObjectGroup');
    return true;
  } catch (error) {
    log.debug(`Object group ${objectGroup} not released: ${getErrorMessage(error)}`);
    return false;
  }
}
