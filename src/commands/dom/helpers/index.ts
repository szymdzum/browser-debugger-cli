/**
 * DOM helpers using CDP relay pattern. Barrel re-exports the split modules
 * so callers can keep importing from `@/commands/dom/helpers.js`.
 *
 * - `query.ts`      — selector → nodeId, DOM.describeNode, attribute unpacking
 * - `screenshot.ts` — page / element capture, element bounds, scroll helpers
 */

export {
  queryDOMElements,
  getDomContext,
  getDOMElements,
  resolveSelector,
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
