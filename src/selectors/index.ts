/**
 * Selector utilities for bdg.
 *
 * Provides Playwright-compatible selector support, transforming custom pseudo-classes
 * into standard CSS + JavaScript filters that can be executed in the browser.
 */

export {
  transformSelector,
  generateQueryScript,
  hasPlaywrightSelectors,
  type TransformedSelector,
} from './playwrightSelectors.js';
