/**
 * Object groups that bdg CLI processes create in the page through the daemon
 * (#606). A CLI releases its group when its call is done; one killed before
 * that cannot, so the daemon remembers each group with the process that owns
 * it and releases the groups of processes that have exited.
 */

import type { ObjectGroupSender } from '@/runtime/page/objectGroups.js';

/** A CDP call forwarded for a CLI, as far as object groups are concerned */
export interface ForwardedCall {
  method: string;
  params?: Record<string, unknown>;
  /** Process id of the CLI that releases the call's object group */
  owner?: number;
}

/** Object groups held for bdg CLI processes, by group name */
export class ClientObjectGroups {
  /**
   * @param isAlive - Whether a process is still running
   */
  constructor(private readonly isAlive: (pid: number) => boolean) {}

  /**
   * Note a forwarded call once it has settled: remember the group it created
   * for its owner, forget a group it released.
   *
   * @param _page - Connection the call went to
   * @param _call - The call
   */
  settled(_page: ObjectGroupSender, _call: ForwardedCall): void {
    throw new Error('not implemented');
  }

  /**
   * Release the groups whose owners have exited. Never throws.
   *
   * @returns Names of the groups released
   */
  releaseOrphans(): Promise<string[]> {
    void this.isAlive;
    throw new Error('not implemented');
  }
}
