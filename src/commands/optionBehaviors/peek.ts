/**
 * Option behaviors of `bdg peek`.
 */

import { FOLLOW_BEHAVIOR, type BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const PEEK_BEHAVIORS: BehaviorTable = {
  'peek:--full': {
    default:
      'Console message texts are cut: human output at 200 characters (compact output also at 2 lines) followed by "… N more chars (use --full)"; JSON text at 10000 characters with truncatedFrom (the original length)',
    whenEnabled: 'Console message texts are printed whole, in human and JSON output',
    tokenImpact: 'A page that logs a large payload can add megabytes per peek',
  },
  'peek:--type': {
    whenEnabled:
      'Filters network requests by CDP resource type. Case-insensitive, comma-separated. Valid: Document, Stylesheet, Image, Media, Font, Script, XHR, Fetch, WebSocket, etc.',
  },
  'peek:--follow': {
    default: 'Shows snapshot of current data',
    whenEnabled:
      'Continuous monitoring (like tail -f): refreshes every second, or every --interval ms (100-60000). Replaces the deprecated bdg tail',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
  'peek:--verbose': {
    default: 'Compact output (truncated URLs, no resource types)',
    whenEnabled: 'Verbose output with full URLs and resource types',
  },
};
