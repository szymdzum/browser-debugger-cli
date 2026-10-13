/**
 * Object groups that bdg CLI processes create in the page through the daemon
 * (#606). A CLI releases its group when its call is done; one killed before
 * that cannot, so the daemon remembers each group with the process that owns
 * it and releases the groups of processes that have exited.
 *
 * A CLI talks to the daemon over one connection per request, so a closed
 * connection does not mean the CLI is gone: the owner's process id does.
 * Only calls that name an owner are tracked (bdg's own page scripts); groups
 * a user names in `bdg cdp` stay until the user releases them. An owner that
 * is not a process id (not a positive safe integer) is ignored and the call
 * goes on untracked: the field is bookkeeping only bdg's CLI sends, so a bad
 * value must not fail the page call, and 0 or a negative id would make the
 * liveness check target a process group instead of the CLI.
 *
 * The map lives with the session (one per command registry) and is emptied
 * where the page's groups disappear anyway: a navigation or a tab switch.
 */

import { releaseObjectGroup, type ObjectGroupSender } from '@/runtime/page/objectGroups.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { isProcessAlive } from '@/utils/process.js';

const log = createLogger('daemon');

/** A CDP call forwarded for a CLI, as far as object groups are concerned */
export interface ForwardedCall {
  method: string;
  params?: Record<string, unknown>;
  /** Process id of the CLI that releases the call's object group (from IPC: checked) */
  owner?: unknown;
}

/** A group held for a CLI */
interface HeldGroup {
  owner: number;
  page: ObjectGroupSender;
}

/** Object groups held for bdg CLI processes, by group name */
export class ClientObjectGroups {
  private readonly groups = new Map<string, HeldGroup>();

  /**
   * @param isAlive - Whether a process is still running
   */
  constructor(private readonly isAlive: (pid: number) => boolean = isProcessAlive) {}

  /**
   * Note a forwarded call once it has settled: remember the group it created
   * for its owner (whether or not the call succeeded: a failed call may still
   * have filled it), forget a group it released successfully (a failed
   * release leaves it for the sweep). Noted after the call settles, so a
   * release never overtakes the call that fills the group.
   *
   * @param page - Connection the call went to
   * @param call - The call
   * @param succeeded - Whether the page answered the call without an error
   */
  settled(page: ObjectGroupSender, call: ForwardedCall, succeeded: boolean): void {
    const objectGroup = call.params?.['objectGroup'];
    if (typeof objectGroup !== 'string') return;
    if (call.method === 'Runtime.releaseObjectGroup') {
      if (succeeded) this.groups.delete(objectGroup);
    } else if (isProcessId(call.owner)) this.groups.set(objectGroup, { owner: call.owner, page });
  }

  /**
   * Forget every group: after a navigation the page's groups are gone; after
   * a tab switch their page is no longer the one the daemon talks to (the old
   * tab keeps them until it navigates or closes).
   */
  clear(): void {
    this.groups.clear();
  }

  /**
   * Release the groups whose owners have exited, on the page each was made
   * on. Each group leaves the map before its release is sent, so sweeps that
   * overlap (callers do not wait for one) never release a group twice.
   *
   * Never rejects, so callers may leave it running: a page that is gone or
   * does not answer took its groups with it, or is given up on after the
   * release's time limit; a failing liveness check is logged at debug level.
   *
   * @returns Names of the groups whose release was sent (confirmed or not)
   */
  async releaseOrphans(): Promise<string[]> {
    try {
      const orphans = [...this.groups].filter(([, held]) => !this.isAlive(held.owner));
      for (const [objectGroup] of orphans) this.groups.delete(objectGroup);
      await Promise.all(
        orphans.map(async ([objectGroup, { owner, page }]) => {
          if (await releaseObjectGroup(page, objectGroup)) {
            log.info(`Released object group ${objectGroup} of exited bdg process ${owner}`);
          }
        })
      );
      return orphans.map(([objectGroup]) => objectGroup);
    } catch (error) {
      log.debug(`Object groups of exited bdg processes not released: ${getErrorMessage(error)}`);
      return [];
    }
  }
}

/**
 * Whether a value can be a CLI's process id.
 *
 * @param value - The `owner` of a forwarded call
 * @returns True for a positive safe integer
 */
function isProcessId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
