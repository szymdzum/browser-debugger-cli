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

export { fillElement, clickElement } from '@/commands/dom/formFillHelpers/fill.js';
export {
  pressKeyElement,
  type PressKeyOptions,
  type PressKeyResult,
} from '@/commands/dom/formFillHelpers/pressKey.js';
export {
  scrollPage,
  type ScrollOptions,
  type ScrollResult,
} from '@/commands/dom/formFillHelpers/scroll.js';
export { waitForActionStability } from '@/commands/dom/formFillHelpers/stability.js';
