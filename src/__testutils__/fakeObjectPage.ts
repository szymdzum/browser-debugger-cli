/**
 * A fake page holding remote objects, for tests of object group handling.
 *
 * Calls that create objects (`DOM.resolveNode`, `Runtime.evaluate`) put them
 * in the object group they name; releasing a group (or an object) frees them,
 * and a later use fails like Chrome's ("Could not find object with given
 * id"). The use of an object can be held until a release happened, which
 * puts another call's release between the lookup and the use, the window in
 * which a release of a shared object group frees another call's objects.
 */

/** Chrome's error for an object id that was released */
export const RELEASED_OBJECT_ERROR = 'Could not find object with given id';

/** Chrome's error for a backend node id that is not in the page */
export const UNKNOWN_NODE_ERROR = 'No node with given id found';

/** Options of a {@link FakeObjectPage} */
export interface FakeObjectPageOptions {
  /**
   * Whether the object a call creates is held: its first use waits until
   * objects were released.
   */
  hold?: (method: string, params: Record<string, unknown>) => boolean;
  /** Which released object groups let held objects be used (default: any) */
  releaseFreesHeld?: (objectGroup: string) => boolean;
  /**
   * Objects created before any is used: uses wait for them, so concurrent
   * calls all look up their objects first (default: no wait).
   */
  lookupsFirst?: number;
  /** Backend node ids not in the page (resolving them fails) */
  goneNodes?: readonly number[];
  /** Result of `Runtime.callFunctionOn` (default: `true` by value) */
  callResult?: (params: Record<string, unknown>) => unknown;
  /** Result of `Runtime.getProperties` (default: none) */
  properties?: (objectId: string) => unknown;
}

/** A remote object of the page */
interface RemoteObject {
  group: string | undefined;
  held: boolean;
}

/**
 * Remote objects of a fake page, answering the CDP calls that create, use and
 * release them, and describing every node as an `<input>`; other methods
 * answer `{}`.
 */
export class FakeObjectPage {
  /** Object groups released, in order */
  readonly releasedGroups: string[] = [];
  /** Uses of an object that had been released */
  readonly releasedUses: string[] = [];
  private readonly objects = new Map<string, RemoteObject>();
  private created = 0;
  private readonly lookups: Array<() => void> = [];
  private signalRelease: () => void = () => undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.signalRelease = resolve;
  });

  constructor(private readonly options: FakeObjectPageOptions = {}) {}

  /**
   * Answer a CDP call.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns The result
   * @throws Error like Chrome's for a released object or an unknown node
   */
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'DOM.resolveNode':
        if (this.options.goneNodes?.includes(params['backendNodeId'] as number)) {
          throw new Error(UNKNOWN_NODE_ERROR);
        }
        return { object: { type: 'object', subtype: 'node', ...this.create(method, params) } };
      case 'DOM.describeNode':
        return {
          node: { backendNodeId: params['backendNodeId'], nodeName: 'INPUT', attributes: [] },
        };
      case 'Runtime.evaluate':
        return { result: { type: 'object', ...this.create(method, params) } };
      case 'Runtime.callFunctionOn':
        await this.use(params['objectId'] as string);
        return this.options.callResult?.(params) ?? { result: { type: 'boolean', value: true } };
      case 'Runtime.getProperties':
        await this.use(params['objectId'] as string);
        return this.options.properties?.(params['objectId'] as string) ?? { result: [] };
      case 'Runtime.releaseObjectGroup':
        this.releasedGroups.push(params['objectGroup'] as string);
        for (const [id, object] of this.objects) {
          if (object.group === params['objectGroup']) this.objects.delete(id);
        }
        if (this.options.releaseFreesHeld?.(params['objectGroup'] as string) ?? true) {
          this.signalRelease();
        }
        return {};
      case 'Runtime.releaseObject':
        this.objects.delete(params['objectId'] as string);
        this.signalRelease();
        return {};
      default:
        return {};
    }
  }

  /**
   * Create an object in the group a call names.
   *
   * @param method - CDP method creating it
   * @param params - Its parameters
   * @returns The object's id
   */
  private create(method: string, params: Record<string, unknown>): { objectId: string } {
    const objectId = `object-${++this.created}`;
    this.objects.set(objectId, {
      group: params['objectGroup'] as string | undefined,
      held: this.options.hold?.(method, params) ?? false,
    });
    if (this.created >= (this.options.lookupsFirst ?? 0)) {
      for (const lookedUp of this.lookups.splice(0)) lookedUp();
    }
    return { objectId };
  }

  /**
   * Use an object: waits for the lookups that come first, and a held object
   * for a release.
   *
   * @param objectId - The object
   * @throws Error when it was released
   */
  private async use(objectId: string): Promise<void> {
    if (this.created < (this.options.lookupsFirst ?? 0)) {
      await new Promise<void>((resolve) => this.lookups.push(resolve));
    }
    if (this.objects.get(objectId)?.held) await this.released;
    if (this.objects.has(objectId)) return;
    this.releasedUses.push(objectId);
    throw new Error(RELEASED_OBJECT_ERROR);
  }
}
