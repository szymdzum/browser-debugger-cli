/**
 * DOM helpers using CDP relay pattern. Barrel re-exports the split modules
 * so callers can keep importing from `@/commands/dom/helpers.js`.
 *
 * - `query.ts`      — selector → backend node ids (shadow roots, same-origin iframes), DOM.describeNode
 * - `screenshot.ts` — page / element capture, element bounds, scroll helpers
 */

export {
  queryDOMElements,
  getDomContext,
  getDOMElements,
  resolveSelector,
  resolveBackendNodeIds,
  resolveA11yNodeForSelector,
  assertNodeAttached,
} from '@/commands/dom/helpers/query.js';

export {
  capturePageScreenshot,
  captureElementScreenshot,
  getElementBounds,
} from '@/commands/dom/helpers/screenshot.js';

export type {
  DomQueryResult,
  DomGetResult,
  ScreenshotResult,
  DomGetOptions,
  ScreenshotOptions,
  DomContext,
  ElementBounds,
} from '@/types.js';
