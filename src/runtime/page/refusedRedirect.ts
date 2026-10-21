/**
 * Redirects Chrome refuses to follow (#890): a main document whose server
 * redirects to a scheme Chrome does not load as a page (`myapp://callback`,
 * `javascript:`, `view-source:`). Chrome aborts the request
 * (`net::ERR_ABORTED`, as for a 204 or a download) and keeps the page it was
 * on, so neither `Page.navigate`'s answer nor the main frame tells it apart.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { FailedLoad } from '@/types.js';

/**
 * Follow the main frame's document requests and tell which ones ended on a
 * redirect Chrome refused.
 *
 * @param _cdp - CDP connection
 * @param _mainFrameId - Main frame id
 * @param _graceMs - How long an aborted request waits for its redirect's headers
 * @returns `refused`: the refused redirect of a request (or of any request
 *   followed, without an id), once its verdict is in; `stop`: stops following
 */
export function watchRefusedRedirects(
  _cdp: Pick<CDPConnection, 'on'>,
  _mainFrameId: string,
  _graceMs?: number
): { refused: (requestId?: string) => Promise<FailedLoad | undefined>; stop: () => void } {
  throw new Error('not implemented');
}
