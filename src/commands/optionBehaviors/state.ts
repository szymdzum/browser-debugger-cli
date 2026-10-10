/**
 * Option behaviors of auth state: `bdg <url> --state` and `bdg state save/load`.
 */

import type { BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const STATE_BEHAVIORS: BehaviorTable = {
  'bdg:--state': {
    default:
      'The session starts with what its Chrome profile kept: persistent cookies and localStorage, but no session cookies (no Expires) and no sessionStorage, so most logins are gone after bdg stop',
    whenEnabled:
      'Before the page first loads, restores a file written by bdg state save: every cookie (session and HttpOnly ones included; expired ones are skipped) and the localStorage and sessionStorage of every saved origin. The start output says what was loaded (State: loaded 3 cookies, storage of 2 origins; JSON data.state with counts and origins, never values)',
    automaticBehavior:
      "Each saved origin with storage gets a blank document in the session tab first (served by Fetch interception: no request reaches the server and no page script runs; service workers bypassed), its items are set with DOMStorage, then the tab goes back to about:blank with its history cleared, before collectors start, so network list and history show only the target. Items are added to what the profile already holds (keys in the file win). A missing file exits 83 with a suggestion before anything starts; an unreadable or invalid one (not JSON, no or another version, a bad cookie or origin field, larger than 50 MB, not a regular file) exits 81. An http origin Chrome loads over https (HSTS, HTTPS-First) is skipped (skipped: upgraded-to-https; that storage is another origin's). Works with --session; with --chrome-ws-url it exits 81 before attaching (it would walk your own tab through the saved origins and clear its history): attach, then run bdg state load <file>. " +
      'The file holds secrets: keep it out of version control',
  },
  'save:--origin': {
    default:
      'Saves the storage of every origin of the page and its same-site frames (first-party storage); cross-site frames are listed as skipped (partitioned). Cookies of every site are always saved',
    whenEnabled:
      'Saves the storage of the given origins only (repeatable; any URL of the origin works); an origin the page has no frame of exits 83 (storage is read through a frame of its origin) and no file is written; not an http(s) URL exits 81',
    automaticBehavior:
      'The file is JSON { version: 1, savedAt, cookies (Network.getAllCookies), origins: [{ origin, localStorage, sessionStorage }] }, written through a temp file renamed over the target: a new file is 0600, an existing one keeps its mode, a symlink at the path is replaced (not followed). Output (human and --json) has counts and origins, never values',
  },
  'load:--no-reload': {
    default:
      'Sets the cookies and the storage of the saved origins the page has frames of, then reloads the page (JSON reload: { url, title, status }) so it sees them',
    whenEnabled:
      'Sets them without reloading; the page sees them on its next request or navigation',
    automaticBehavior:
      "Mid-session, storage is written through frames of its origin: a saved origin the page has no frame of is listed as skipped (not-on-page); start with bdg <url> --state <file> to restore every origin. Items are added to the existing ones (keys in the file win). Expired cookies are skipped. A missing file exits 83, an invalid one 81, both with a suggestion; output shows counts only (origins in the file, empty ones included). With --chrome-ws-url (an attached Chrome) it writes the cookies and storage into that browser's own profile and reloads your tab unless --no-reload",
  },
};
