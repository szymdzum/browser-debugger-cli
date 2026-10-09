/**
 * DOM helpers using CDP relay pattern. Barrel re-exports the split modules
 * so callers can keep importing from `@/commands/dom/helpers.js`.
 *
 * - `query.ts`      — selector → backend node ids (shadow roots, same-origin iframes), DOM.describeNode
 * - `screenshot.ts` — page / element capture through the daemon, writing the image
 */

export {
  noMatchesError,
  queryDOMElements,
  getDomContext,
  getDOMElements,
  resolveSelector,
  resolveBackendNodeIds,
  selectMatch,
  assertNodeAttached,
  pageDocumentId,
} from '@/commands/dom/helpers/query.js';

export { captureScreenshot, screenshotInterrupted } from '@/commands/dom/helpers/screenshot.js';

export type { DomGetOptions, DomContext } from '@/types.js';
