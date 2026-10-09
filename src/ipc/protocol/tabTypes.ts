/**
 * Protocol-owned DTOs for the session's tabs: tabs and windows an action
 * opened, `bdg page tabs`, `bdg page switch` and `bdg page close`.
 */

/**
 * How a new page was opened: `popup` when it can reach its opener through
 * `window.opener` (`window.open()` without `noopener`: OAuth, SSO and payment
 * windows that report back and close themselves), `tab` when it cannot
 * (`target=_blank` links, `noopener`).
 */
export type OpenedTabKind = 'popup' | 'tab';

/** A tab or window an action opened */
export interface OpenedTab {
  /** URL of the new page when the action returned (`about:blank` until it commits) */
  url: string;
  /** CDP target id */
  targetId: string;
  kind: OpenedTabKind;
  /** Its index in `bdg page tabs` (absent when it already closed) */
  index?: number;
}

/** A tab of the session's Chrome */
export interface TabRef {
  /** 0-based index in `bdg page tabs` (absent for a tab that closed) */
  index?: number;
  /** CDP target id */
  targetId: string;
  url: string;
  title: string;
}

/** A tab as `bdg page tabs` lists it */
export interface TabInfo extends TabRef {
  index: number;
  /** The tab the session acts on */
  current?: true;
  /** Index of the tab that opened it, while that one is open */
  openedBy?: number;
}

/** The session's tab closed (e.g. a popup called `window.close()`) and the session moved on */
export interface TabClosedSwitch {
  /** The tab that closed */
  tabClosed: TabRef;
  /** The tab the session acts on now: the closed tab's opener, else the tab used before it */
  switchedTo: TabRef;
}

/** page_tabs: list the page targets (tabs and windows) */
export type PageTabsCommand = Record<string, never>;

/** The tabs, in `bdg page switch` index order */
export interface PageTabsData {
  tabs: TabInfo[];
}

/** page_switch: make another tab the session's */
export interface PageSwitchCommand {
  /** 0-based index, target id, or part of the URL */
  target: string;
}

/** The tab switched to */
export interface PageSwitchData {
  tab: TabInfo;
  /** The tab the session was on (absent when it already was on `tab`) */
  previous?: TabRef;
}

/** page_close: close a tab (the session's own by default) */
export interface PageCloseCommand {
  /** 0-based index, target id, or part of the URL (the session's tab when absent) */
  target?: string;
}

/** What `bdg page close` did */
export interface PageCloseData {
  closed: TabRef;
  /** The tab the session acts on now */
  current: TabInfo;
  /** The closed tab was the session's: the session moved to `current` */
  switched?: true;
}
