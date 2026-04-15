/**
 * Form-fill helper barrel. Splits the former formFillHelpers.ts into:
 *
 * - `fill.ts`      — fillElement, clickElement
 * - `pressKey.ts`  — pressKeyElement + types
 * - `scroll.ts`    — scrollPage + types
 * - `stability.ts` — waitForActionStability
 * - `shared.ts`    — internal script/error helpers
 *
 * Callers keep importing from `@/commands/dom/formFillHelpers.js` which
 * resolves to this barrel.
 */

export { fillElement, clickElement } from '@/runtime/dom/formFillHelpers/fill.js';
export {
  pressKeyElement,
  type PressKeyOptions,
  type PressKeyResult,
} from '@/runtime/dom/formFillHelpers/pressKey.js';
export {
  scrollPage,
  type ScrollOptions,
  type ScrollResult,
} from '@/runtime/dom/formFillHelpers/scroll.js';
export { waitForActionStability } from '@/runtime/dom/formFillHelpers/stability.js';
