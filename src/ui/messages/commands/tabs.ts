/**
 * Tab messages.
 */

import type { OpenedTab, TabInfo, TabRef, TabSwitchInfo } from '@/ipc/protocol/tabTypes.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Note under a console or network view after the session moved to another
 * tab: what that tab did before is not recorded (Chrome replays the console
 * messages of a tab the session was never on, so those are), and what is
 * listed from before is the other tab's.
 *
 * @param tabSwitch - The session's latest move
 * @param view - What the view lists
 * @returns e.g. `Switched to tab 1 at 18:02:11 (http://localhost/popup); its earlier requests are not recorded`, or undefined when nothing is missing
 */
export function tabSwitchNote(
  tabSwitch: TabSwitchInfo,
  view: 'network' | 'console' | 'all'
): string | undefined {
  const requests = view !== 'console';
  const messages = view !== 'network' && !tabSwitch.consoleReplayed;
  if (!requests && !messages) return undefined;
  const logged = 'what it logged while the session was on another tab';
  const missing =
    requests && messages
      ? `its earlier requests and ${logged} are not recorded`
      : requests
        ? 'its earlier requests are not recorded'
        : `${logged} is not recorded`;
  const tab = tabSwitch.tab.index === undefined ? 'a tab' : `tab ${tabSwitch.tab.index}`;
  const at = new Date(tabSwitch.at).toLocaleTimeString();
  return `Switched to ${tab} at ${at} (${tabSwitch.tab.url}); ${missing}`;
}

/**
 * Put the tab-switch note under a console or network view, after the
 * session moved to another tab.
 *
 * @param body - The view
 * @param tabSwitch - The session's latest move, if any
 * @param view - What the view lists
 * @returns The view, with the note when something is missing
 */
export function withTabSwitchNote(
  body: string,
  tabSwitch: TabSwitchInfo | undefined,
  view: 'network' | 'console' | 'all'
): string {
  const note = tabSwitch && tabSwitchNote(tabSwitch, view);
  return note
    ? `${body}

${note}`
    : body;
}

/**
 * `bdg status` warning while tabs are not tracked.
 *
 * @param reason - Chrome's answer to target discovery
 * @returns Warning
 */
export function tabsNotTrackedWarning(reason: string): string {
  return `Tabs are not tracked: ${reason}`;
}

/**
 * A tab or window an action opened, e.g.
 * `Opened: popup http://localhost/authorize (bdg page switch 1)`.
 *
 * @param tab - The opened tab
 * @returns Line
 */
export function openedTabText(tab: OpenedTab): string {
  const next =
    tab.index === undefined ? 'closed again' : sessionCommand(`bdg page switch ${tab.index}`);
  return `Opened: ${tab.kind} ${tab.url} (${next})`;
}

/**
 * The session's tab closed and the session moved to another, e.g.
 * `Tab closed: http://localhost/authorize; now on tab 0: http://localhost/`.
 *
 * @param closed - The tab that closed
 * @param current - The tab the session moved to
 * @returns Line
 */
export function tabClosedText(closed: TabRef, current: TabRef): string {
  const where = current.index === undefined ? '' : ` ${current.index}`;
  return `Tab closed: ${closed.url}; now on tab${where}: ${current.url}`;
}

/**
 * A tab as `bdg page tabs` lists it, e.g. `* [0] Shop  http://localhost/`.
 *
 * @param tab - Tab
 * @returns Line
 */
export function tabListText(tab: TabInfo): string {
  const marker = tab.current ? '*' : ' ';
  const title = tab.title && tab.title !== tab.url ? `${tab.title}  ` : '';
  const opener = tab.openedBy === undefined ? '' : ` (opened by ${tab.openedBy})`;
  return `${marker} [${tab.index}] ${title}${tab.url || 'about:blank'}${opener}`;
}

/**
 * How to move between tabs, under `bdg page tabs`.
 *
 * @returns Line
 */
export function tabSwitchHint(): string {
  return `Switch with: ${sessionCommand('bdg page switch <index|url-part>')}`;
}

/**
 * Note after `bdg page switch` on what follows the tab and how to go back.
 *
 * @param previous - The tab the session was on
 * @returns Line
 */
export function tabSwitchedNote(previous: TabRef | undefined): string {
  const back =
    previous?.index === undefined
      ? ''
      : `; back with: ${sessionCommand(`bdg page switch ${previous.index}`)}`;
  return `Network and console now record this tab${back}`;
}
