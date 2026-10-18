/**
 * Option behaviors of logpoints: `bdg debug log` (#848).
 */

import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const DEBUG_BEHAVIORS: BehaviorTable = {
  'log:--max': {
    default:
      'Logs the first 100 hits of the logpoint on each page load and counts the rest as dropped (debug list: hits, dropped); at most 100 hits per logpoint and page load are stored',
    whenEnabled:
      'Logs the first n hits per page load; the counter lives in the page and starts again on every load. The condition still runs for each hit, about 85 microseconds each, so the cap protects the output, not the page speed',
    automaticBehavior:
      'Expressions run in the page at that line and may change it (an assignment or a call runs for real, on every hit). A debugger; statement does not pause the page while a logpoint exists (pauses are skipped, and any that happens anyway is resumed, your own breakpoints from bdg cdp or DevTools included). Values are those before the line runs. Logpoints survive reloads and same-site navigations until bdg stop or debug clear, and are set again on the tab the session moves to (and back); bdg stop gives Chrome back as it was (binding removed, pauses allowed, Debugger disabled). The hits reach bdg through a page global binding (__bdg_lp_7c1f): the app can see or overwrite it. No logpoint hit appears in bdg console',
    tokenImpact:
      'Action reports (dom click, fill, press-key) add one line per logpoint that ran, at most 3, then "+N more logpoints"; bdg debug hits lists the stored values',
  },
  'log:--if': {
    default: 'Every hit of the line is logged',
    whenEnabled:
      'The expression runs first at the line, in the page, and the hit is counted and logged only when it is truthy. An expression that throws counts as an error of the logpoint (debug list: errors, lastError) and logs nothing',
  },
  'hits:--page': {
    default: 'Shows the hits of the page now loaded (hits carry the navigationId of their load)',
    whenEnabled:
      'all: also the hits of earlier page loads, at most 1000 per logpoint, the oldest dropped first',
  },
};
