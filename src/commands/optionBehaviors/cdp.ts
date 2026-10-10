/**
 * Option behaviors of `bdg cdp`.
 */

import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const CDP_BEHAVIORS: BehaviorTable = {
  'cdp:--send-anyway': {
    default:
      'A Domain.method 1 edit from a bundled method or domain (2 for names over 5 letters, case ignored) is taken for a typo: exit 81 with Did you mean',
    whenEnabled:
      'Sends such a name to Chrome as typed (for a method newer than the bundled protocol, e.g. next to a bundled sibling like getWindowBounds/setWindowBounds), with the not-in-bundled-protocol warning',
    automaticBehavior:
      'Blocked methods (Page.captureScreenshot, Page.close, Browser.close), type names and names that are not Domain.method are still refused; a well-formed name far from every bundled one is sent without the flag',
  },
  'cdp:--describe': {
    default:
      'Without --describe, a Domain.method is called (one missing from the bundled protocol is sent as typed, with a warning: only bundled methods are matched case-insensitively)',
    whenEnabled:
      'Describes a domain, a method (parameters with ? for optional, returns, example) or a protocol type (Domain.Type: enum values or object properties)',
    automaticBehavior:
      'Parameters referring to an enum type list its values inline (JSON enum, ref, refType); a redirected method (DOM.highlightNode) also shows the method implementing it and its parameters, which Chrome checks (JSON redirect, resolved: true); a redirect to a method the protocol lacks (Page.deleteCookie → Network.deleteCookie) is shown as unresolved (resolved: false). Example values work as typed: width 1280, height 800, x/y 100, deviceScaleFactor/scale 1, timeout 5000, url https://example.com, other numbers 1 (never 0, which often means off)',
  },
  'cdp:--collect': {
    default: 'A method call returns only its response; events it causes are not shown',
    whenEnabled:
      'Subscribes to the events (comma-separated, checked against the bundled protocol: typos exit 81 with Did you mean) before sending the method, and collects them until the --until event arrives (included) or --timeout passes, at least until the method answered. JSON data: { method, result, events: [{ method, params, ts }], count, complete } (+ omitted when cut)',
    automaticBehavior:
      'Only events of the session page itself are collected: events of attached child sessions (out-of-process iframes, workers after Target.setAutoAttach with flatten) carry a sessionId bdg cdp cannot send commands to and are left out. A method that fails discards the collection (and its --out file)',
    tokenImpact:
      'Without --out, events are kept to about 20000 characters of JSON: later events are counted in omitted, and a first event over that has its params cut to the start of their JSON text (a string, with truncatedFrom). A trace is megabytes: always use --out for Tracing.dataCollected and HeapProfiler chunks',
  },
  'cdp:--until': {
    default: 'Without --until, --collect collects for the whole --timeout (complete: true)',
    whenEnabled:
      'Collection ends when this event arrives (it is collected too; it alone, without --collect, waits for it). If it does not arrive within --timeout, the events so far are returned with complete: false and a hint, exit 0, not an error',
  },
  'cdp:--timeout': {
    default:
      'A collection lasts at most 10 s (at least until the method answered); seconds, decimals allowed, max 120',
    whenEnabled:
      'The daemon extends its 30 s command timeout to this plus 5 s, so the command blocks up to that long. Without --until it is how long events are collected',
  },
  'cdp:--out': {
    default: 'Events are returned in the output, kept to about 20000 characters',
    whenEnabled:
      'The daemon writes every event as one NDJSON line ({ method, params, ts }) as it arrives, to a new temp file next to the target (created exclusively, never through a symlink) that replaces the file only once the command succeeded: a failed method or write leaves an existing file as it was. An existing file keeps its mode. A symlink at the path is replaced by a regular file, and the file it pointed to is left untouched. It returns { file, count, bytes } instead of the events. Should the disk fall over 64 MB behind, further events are dropped and counted (dropped, complete: false); --events removes events from the buffer only once the file is in place. A trace becomes a DevTools Performance file with: jq -s \'{traceEvents: [.[] | select(.method == "Tracing.dataCollected") | .params.value[]]}\' trace.ndjson > trace.json',
  },
  'cdp:--listen': {
    default: 'Events between commands are not kept',
    whenEnabled:
      'Buffers the events (comma-separated) in the daemon until read with --events or dropped with --unlisten; repeated --listen adds events. With a method, listening starts before it is sent (bdg cdp Fetch.enable --params ... --listen Fetch.requestPaused)',
    automaticBehavior:
      'The buffer holds at most 1000 events and 10 MB of event JSON (UTF-8 bytes); beyond either the oldest are dropped and counted in dropped. Only events of the session page are kept (not of attached iframe or worker sessions). The buffer ends with the session',
  },
  'cdp:--events': {
    default: 'Buffered events stay in the daemon',
    whenEnabled:
      'Returns buffered events (all, or the comma-separated ones named) and removes them from the buffer; JSON { events, count, listening, buffered, dropped }. Exit 83 when nothing is listened to',
    tokenImpact:
      'Kept to about 20000 characters of JSON per call: events that do not fit stay buffered (remaining) for the next call; --out writes them all',
  },
  'cdp:--wait': {
    default: '--events returns at once, also with no events',
    whenEnabled:
      'Waits up to this many seconds (max 120) for a matching event when none is buffered; when none comes it returns no events with waitedOut: true, exit 0',
  },
  'cdp:--clear': {
    default: '--events returns the events it removes',
    whenEnabled: 'Discards the matching buffered events without returning them (JSON cleared)',
  },
  'cdp:--unlisten': {
    default: 'Listening lasts until the session ends',
    whenEnabled:
      'Stops listening to every event and discards the buffer (JSON stopped, discarded). Exit 83 when nothing is listened to',
  },
};
