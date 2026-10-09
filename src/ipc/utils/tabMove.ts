/**
 * A move of the session to another tab that no command reported yet (its
 * tab closed on its own, e.g. a popup's timer called `window.close()`): the
 * daemon puts it on one response (`tabMoved`), and the CLI keeps it until
 * the command's output reports it.
 */

import type { TabClosedSwitch } from '@/ipc/protocol/tabTypes.js';

/** The move a response of this command carried */
let pending: TabClosedSwitch | undefined;

/**
 * Keep the move a daemon response carries, if any.
 *
 * @param response - Daemon response
 */
export function noteTabMove(response: unknown): void {
  if (typeof response !== 'object' || response === null) return;
  const { tabMoved } = response as { tabMoved?: TabClosedSwitch };
  if (tabMoved) pending = tabMoved;
}

/**
 * The move a response carried, for the command's output; given once.
 *
 * @returns The move, or undefined
 */
export function takeTabMove(): TabClosedSwitch | undefined {
  const moved = pending;
  pending = undefined;
  return moved;
}
