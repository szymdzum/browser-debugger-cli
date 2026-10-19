/**
 * Option behaviors of the session commands: `bdg <url>` (root options), cleanup, stop and status.
 */

import {
  MASKED_URL_AUTOMATIC,
  MASKED_URL_DEFAULT,
  MASKED_URL_ENABLED,
  type BehaviorTable,
} from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const SESSION_BEHAVIORS: BehaviorTable = {
  'bdg:--headless': {
    default:
      'A window when there is a display: on macOS unless over SSH (SSH_CONNECTION, SSH_TTY) or CI is set; on Linux when DISPLAY or WAYLAND_DISPLAY is set. Servers, containers and CI run headless',
    whenEnabled: 'Chrome runs without a window (pass it when running unattended on a Mac)',
  },
  'bdg:--no-headless': {
    default:
      'A window when there is a display: on macOS unless over SSH (SSH_CONNECTION, SSH_TTY) or CI is set; on Linux when DISPLAY or WAYLAND_DISPLAY is set',
    whenEnabled: 'Chrome shows its window even without a detected display (it fails without one)',
  },
  'bdg:--capture-all': {
    default:
      'Tracking/analytics requests and console noise are filtered; bodies of binary responses (images, fonts) are not captured',
    whenEnabled:
      'Everything is captured, including binary response bodies (base64, flagged by responseBodyBase64, within --max-body-size)',
    tokenImpact:
      'HAR exports can grow considerably on media-heavy pages (network details caps a body at 20000 characters unless --body)',
  },
  'bdg:--stop-after': {
    default: 'The session runs until bdg stop, Chrome closes or the page closes',
    whenEnabled:
      'The session stops itself this many seconds (1-3600) after the page has loaded, as bdg stop does; the start output shows the time (autoStopAt with --json)',
    automaticBehavior:
      'Seconds, unlike the --timeout of waits (milliseconds); the old -t/--timeout still works with a deprecation warning, and exits 81 when given together with --stop-after and another value',
  },
  'attach:--stop-after': {
    default: 'The attached session runs until bdg stop, or until the tab or the browser closes',
    whenEnabled:
      'The session stops itself this many seconds (1-3600) after attaching; the tab stays open',
  },
  'attach:--dialog': {
    default:
      'dismiss, unlike bdg <url> (accept): the attached browser is your own, where an accepted confirm() can submit or delete real data. confirm() returns false, prompt() null, and the action result says "confirm() dismissed"',
    whenEnabled:
      'accept or dismiss (any case) for every alert, confirm and prompt of the session unless the running DOM action chose otherwise with its own --dialog/--prompt-text. Other values exit 81 with a suggestion (ok/yes: accept, cancel/no: dismiss)',
    automaticBehavior:
      'beforeunload dialogs are still accepted (navigation is never blocked) unless a DOM action is given --dialog dismiss. bdg status always shows the default of an attach session (Dialogs: dismiss (session default), JSON dialog)',
  },
  'bdg:--session': {
    default:
      'The default session in ~/.bdg (or $BDG_SESSION_DIR); BDG_SESSION=<name> selects a named session like the flag',
    whenEnabled:
      'Uses the named session in ~/.bdg/sessions/<name>/ (or $BDG_SESSION_DIR/sessions/<name>/) with its own daemon, Chrome, profile and port; every command (status, stop, cleanup, ...) acts on that session only',
    automaticBehavior:
      'Accepted before or after any subcommand; --session wins over BDG_SESSION. Names are case-insensitive (lower-cased: ALPHA is alpha). Without --port a named session takes the first free port above 9222 not claimed by another running session, and keeps it in port.txt. Names: 1-40 letters, digits, "-" or "_", starting with a letter or digit (exit 81 otherwise, also when the socket path would be too long). Hints and suggestions in its output carry --session <name>',
  },
  'cleanup:--force': {
    default: 'Refuses to run while a session is active; removes files left by a crashed session',
    whenEnabled: 'Kills the running daemon and its Chrome first (use when a session is stuck)',
  },
  'cleanup:--aggressive': {
    whenEnabled:
      'Same as --force, with a deprecation warning (stderr; warnings in the --json envelope); hidden from help, exits 81 from 1.0',
  },
  'cleanup:--purge': {
    default:
      "A named session's directory (Chrome profile, ~60 MB; logs; port.txt; downloads/) is kept for its next start",
    whenEnabled:
      'After cleaning up, deletes the directory of the session named by --session, downloaded files included (exit 81 without --session); a running session is refused unless --force is given, and the directory is kept (exit 90) if the daemon still answers, cleanup reported a problem, or its Chrome has not exited',
  },
  'bdg:--viewport': {
    default:
      'A launched Chrome opens a 1920x1080 window (the viewport is smaller by the scrollbar, and in a visible window by the browser UI); an attached Chrome keeps its window',
    whenEnabled:
      'The page gets exactly that viewport (CSS px, e.g. 1280x800) for the whole session, through navigations and reloads (Emulation.setDeviceMetricsOverride at the display pixel ratio); a launched Chrome also opens its window at that size, so tabs the page opens get it too',
    automaticBehavior:
      'Works with --chrome-ws-url: the override belongs to the session, and Chrome drops it when the session ends, so the attached browser gets its own size back. bdg status shows the resulting layout viewport without the scrollbar (Viewport: 1265×800 (emulated 1280x800)). Invalid sizes (not WxH, a side outside 1-10000) exit 81',
  },
  'bdg:--mobile': {
    default:
      'A desktop viewport: classic scrollbars take ~15px of the width, no touch, a desktop user agent',
    whenEnabled:
      'Emulates a phone for the whole session: a mobile viewport (390x844 unless --viewport) at pixel ratio 3 with mobile layout (meta viewport, overlay scrollbars, so 100vw fits), touch (pointer: coarse, maxTouchPoints 5) and an Android Chrome user agent with mobile client hints; bdg page emulate --mobile turns it on mid-session, --viewport WxH without --mobile or --reset turns it off',
    automaticBehavior:
      'Screenshots keep the mobile layout and are taken at pixel ratio 1 (CSS px = image px); bdg status shows "(emulated 390x844, phone)"',
  },
  'bdg:--color-scheme': {
    default:
      'The page sees the system setting for prefers-color-scheme (headless Chrome follows the OS, so a dark OS renders dark pages); bdg status and dom layout show which one',
    whenEnabled:
      'Emulates prefers-color-scheme: light or dark for the whole session (Emulation.setEmulatedMedia); other values exit 81 with a suggestion',
    automaticBehavior:
      'Applies to the session page (and its same-process iframes); Chrome drops it when the session ends, also for an attached Chrome (--chrome-ws-url)',
  },
  'bdg:--dialog': {
    default:
      'JavaScript dialogs are accepted as they open (OK; prompt() gets its default value, "" without one), so they never block the page',
    whenEnabled:
      'accept or dismiss (Cancel: confirm() returns false, prompt() null) for every alert, confirm and prompt dialog of the session, page loads and navigations included, unless the running DOM action chose otherwise with its own --dialog/--prompt-text. Case does not matter (Dismiss works). Other values exit 81 with a suggestion (ok/yes: accept, cancel/no: dismiss)',
    automaticBehavior:
      'beforeunload dialogs are still accepted (navigation is never blocked); only a DOM action given --dialog dismiss cancels one. Dialogs answered while the page loads are listed in the output of bdg <url> and page navigate/reload/back/forward (Dialog: confirm() dismissed: "…", JSON dialogs), and bdg status shows a dismiss default (Dialogs: dismiss (session default), JSON dialog). With console telemetry each dialog is also a console message ("confirm() dialog dismissed: …"). Applies to an attached Chrome (--chrome-ws-url) too, as bdg always answered its dialogs there: those of the session page are answered as they open, so a person using that browser does not get to answer them; other tabs are left alone',
  },
  'bdg:--chrome-ws-url': {
    default: 'bdg launches its own Chrome (closed on stop)',
    whenEnabled:
      'Attaches to a running Chrome instead; it keeps running after stop. --port, -u and --[no-]headless cannot be combined with it (exit 81)',
    automaticBehavior:
      'A port (9222), host:port or http://host:port is turned into the browser WebSocket URL via /json/version; a browser URL uses the first open tab. Refused with exit 90 when another running bdg session launched that Chrome or drives that tab (sessions of this BDG_SESSION_DIR, and of others that claimed a port). Downloads are not redirected: they go to the download folder of that Chrome (usually ~/Downloads), and only downloads of the session page are reported (not those of tabs or popups it opens)',
  },
  'attach:--chrome-ws-url': {
    default:
      "Without it bdg attach reads the DevToolsActivePort file of Chrome stable's default profile (or --user-data-dir) and connects to the browser path it names; with --user-data-dir too it exits 81",
    whenEnabled:
      'bdg attach lists the page tabs of that Chrome (no tab argument) or starts a session on the tab the argument names, without navigating or reloading it',
    automaticBehavior:
      'A port (9222), host:port or http://host:port is turned into the browser WebSocket URL via /json/version once; after that the session uses one WebSocket to the browser endpoint (Target.getTargets, Target.attachToTarget with flatten) and no HTTP. Downloads of that tab and its iframes are reported and saved where the browser saves them (its download settings are kept; events of other tabs are ignored). dom screenshot of a tab Chrome does not render (in the background, or its main thread busy over 2 s) exits 85 within 2 s (no animation frame came; bdg never brings it to the front). Not reported: downloads of popups or tabs it opens, events without a frame id, and tabs of a non-default (incognito) browser context. Console messages and errors logged before the attach are replayed; earlier network requests are not available. bdg stop only detaches; page switch exits 81',
  },
  'attach:--user-data-dir': {
    default:
      "bdg attach reads DevToolsActivePort from Chrome stable's default profile (macOS ~/Library/Application Support/Google/Chrome, Linux $CHROME_CONFIG_HOME or $XDG_CONFIG_HOME or ~/.config + /google-chrome, Windows %LOCALAPPDATA%\\Google\\Chrome\\User Data)",
    whenEnabled:
      'Reads DevToolsActivePort from that profile dir instead (Chrome Canary, Edge, Brave, any Chromium started with --remote-debugging-port=0 --user-data-dir)',
    automaticBehavior:
      'Chrome writes the file when remote debugging is enabled at chrome://inspect/#remote-debugging; bdg builds ws://127.0.0.1:<port>/devtools/browser/<id> from it with no HTTP call (/json is 404 in that mode). Chrome asks the user to allow each connection: bdg opens exactly one per command and never retries; declined exits 82, unanswered within 30 s exits 102 (Ctrl-C exits 130, no session left). No file, an unreadable file or a stale one (nothing listening: remote debugging turned off or Chrome closed) exits 83 naming the file. Combined with --chrome-ws-url exits 81',
  },
  'stop:--kill-chrome': {
    default:
      'Chrome launched by bdg is always closed on stop; an attached Chrome (--chrome-ws-url) is left running',
    whenEnabled:
      "No additional effect, with a deprecation warning (stderr; warnings in the --json envelope); hidden from help, exits 81 from 1.0. Refused (exit 81) for a session started with bdg attach: that Chrome is the user's",
  },
  'status:--verbose': {
    default: 'Basic session status (daemon running, session active, URL)',
    whenEnabled: 'Includes Chrome diagnostics and CDP connection details',
  },
  'status:--include-sensitive': {
    default: `${MASKED_URL_DEFAULT} (the Session active line, the Target section, pageState.url and a starting session's URL)`,
    whenEnabled: MASKED_URL_ENABLED,
    automaticBehavior: MASKED_URL_AUTOMATIC,
  },
  'sessions:--include-sensitive': {
    default: `${MASKED_URL_DEFAULT} (the URL column, JSON url)`,
    whenEnabled: MASKED_URL_ENABLED,
    automaticBehavior: MASKED_URL_AUTOMATIC,
  },
  'info:--include-sensitive': {
    default: `${MASKED_URL_DEFAULT} (bdg page info: the URL line, JSON url)`,
    whenEnabled: MASKED_URL_ENABLED,
    automaticBehavior: MASKED_URL_AUTOMATIC,
  },
  'tabs:--include-sensitive': {
    default: `${MASKED_URL_DEFAULT} (bdg page tabs: every tab; page switch and page close results are always masked)`,
    whenEnabled: MASKED_URL_ENABLED,
    automaticBehavior: MASKED_URL_AUTOMATIC,
  },
};
