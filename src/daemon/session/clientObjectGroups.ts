/**
 * Object groups that bdg CLI processes create in the page through the daemon
 * (#606). A CLI releases its group when its call is done; one killed before
 * that cannot, so the daemon remembers each group with the process that owns
 * it and releases the groups of processes that have exited.
 *
 * A CLI talks to the daemon over one connection per request, so a closed
 * connection does not mean the CLI is gone: the owner's process id does.
 * Only calls that name an owner are tracked (bdg's own page scripts); groups
 * a user names in `bdg cdp` stay until the user releases them.
 */

import { releaseObjectGroup, type ObjectGroupSender } from '@/runtime/page/objectGroups.js';
import { createLogger } from '@/ui/logging/index.js';
import { isProcessAlive } from '@/utils/process.js';

const log = createLogger('daemon');

/** A CDP call forwarded for a CLI, as far as object groups are concerned */
export interface ForwardedCall {
  method: string;
  params?: Record<string, unknown>;
  /** Process id of the CLI that releases the call's object group */
  owner?: number;
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
   * for its owner, forget a group it released. Noted after the call settles,
   * so a release never overtakes the call that fills the group.
   *
   * @param page - Connection the call went to
   * @param call - The call
   */
  settled(page: ObjectGroupSender, call: ForwardedCall): void {
    const objectGroup = call.params?.['objectGroup'];
    if (typeof objectGroup !== 'string') return;
    if (call.method === 'Runtime.releaseObjectGroup') this.groups.delete(objectGroup);
    else if (call.owner !== undefined) this.groups.set(objectGroup, { owner: call.owner, page });
  }

  /**
   * Release the groups whose owners have exited, on the page each was made
   * on. Never throws: a page that is gone or does not answer took its groups
   * with it, or is given up on after the release's time limit.
   *
   * @returns Names of the groups whose release was sent (confirmed or not)
   */
  async releaseOrphans(): Promise<string[]> {
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
  }
}
