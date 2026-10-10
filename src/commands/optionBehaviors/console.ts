/**
 * Option behaviors of `bdg console`.
 */

import { FOLLOW_BEHAVIOR, type BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const CONSOLE_BEHAVIORS: BehaviorTable = {
  'console:--full': {
    default:
      'Message texts are cut: human output (summary, --list, --follow) at 200 characters followed by "… N more chars (use --full)"; JSON text at 10000 characters with truncatedFrom (the original length)',
    whenEnabled: 'Message texts are printed whole, in human and JSON output',
    tokenImpact:
      'A page that logs a large payload or throws a long error can add megabytes; bdg details console <n> shows one message whole',
  },
  'console:--history': {
    default: 'Shows messages from current page load only (most recent navigation)',
    whenEnabled: 'Shows messages from ALL page loads during the session',
    automaticBehavior:
      'Page navigations create new "navigation contexts" - default filters to latest context',
  },
  'console:--list': {
    default:
      'Smart summary with errors deduplicated and warnings grouped: the newest 50 distinct errors and warnings, with a note for the earlier ones. The session keeps the newest 10000 messages; dropped ones are counted (dropped in JSON)',
    whenEnabled: 'Lists all messages chronologically without deduplication',
  },
  'console:--last': {
    default: 'Smart summary (without --list); a list shows the last 100 messages',
    whenEnabled:
      'Lists the last N messages (0 = all) chronologically, also without --list; JSON gets messages and N distinct errors and warnings (0 = all; default 50)',
    automaticBehavior:
      'The [n] shown are positions in the session message list (what bdg details console <n> takes); when the page or level filter left messages out between the listed ones, a note says how many and why',
  },
  'console:--level': {
    default: 'Shows all log levels (error, warning, log, info, debug)',
    whenEnabled:
      'Filters to specific level: error, warning, log, info, or debug; the Issues block (Chrome Issues of the page) is left out',
  },
  'console:--follow': {
    default: 'Prints the messages logged so far and exits',
    whenEnabled: 'Streams new messages as they come (the last --last at start)',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
};
