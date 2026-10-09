/**
 * CDP event collection in the daemon. IPC is request/response, so events are
 * held in the daemon and returned with an answer:
 *
 * - `collectEvents` (`bdg cdp <Method> --collect`): subscribes, sends the
 *   method, and collects until the `--until` event or the timeout, at least
 *   until the method answered;
 * - `CdpEventListener` (`--listen`, `--events`, `--unlisten`): a bounded
 *   buffer that keeps events between commands.
 *
 * Only events of the page's own target are kept: Chrome tags events of
 * attached child sessions (out-of-process iframes, workers after
 * `Target.setAutoAttach` with `flatten`) with a `sessionId`, and `bdg cdp`
 * cannot send the commands that would answer them.
 */

import * as fs from 'fs';
import * as path from 'path';

import { outputPathError } from '@/commands/shared/outputFile.js';
import {
  EVENT_OUTPUT_MAX_CHARS,
  EventBuffer,
  EventPage,
  LISTEN_LIMITS,
  type EventBufferLimits,
  type EventMatch,
} from '@/daemon/session/cdpEventBuffer.js';
import { CommandError } from '@/errors/index.js';
import type {
  CdpCollectedEvents,
  CdpCollectParams,
  CdpEventRecord,
  CdpEventsCommand,
  CdpEventsData,
  CdpEventsDelivery,
  CdpListenState,
} from '@/ipc/protocol/cdpEventTypes.js';
import { cdpNotListeningError } from '@/ui/messages/cdpEvents.js';
import { delay } from '@/utils/async.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** What events are subscribed on (the session's CDP connection) */
export interface EventSource {
  on<T = unknown>(event: string, handler: (params: T, sessionId?: string) => void): () => void;
}

/** Subscribe to events of the page's own target, skipping child sessions' */
function onPageEvent(
  source: EventSource,
  name: string,
  handler: (event: CdpEventRecord) => void
): () => void {
  return source.on(name, (params, sessionId) => {
    if (sessionId === undefined) handler({ method: name, params, ts: Date.now() });
  });
}

/**
 * An NDJSON file events are written to as they arrive, one per line.
 */
class NdjsonFile {
  count = 0;
  bytes = 0;
  private error: unknown;

  private constructor(
    readonly file: string,
    private readonly stream: fs.WriteStream
  ) {
    stream.on('error', (error) => {
      this.error = error;
    });
  }

  /**
   * Create (or truncate) the file, with its directory.
   *
   * @param file - Absolute path
   * @returns The open file
   * @throws CommandError naming the path when it cannot be written
   */
  static async open(file: string): Promise<NdjsonFile> {
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const handle = await fs.promises.open(file, 'w');
      return new NdjsonFile(file, handle.createWriteStream());
    } catch (error) {
      throw outputPathError(file, error, '.ndjson');
    }
  }

  /**
   * Append an event.
   *
   * @param event - Event
   */
  write(event: CdpEventRecord): void {
    const line = `${JSON.stringify(event)}\n`;
    this.stream.write(line);
    this.count++;
    this.bytes += Buffer.byteLength(line);
  }

  /**
   * Flush and close the file.
   *
   * @returns What was written
   * @throws CommandError naming the path when a write failed
   */
  async close(): Promise<Required<Pick<CdpEventsDelivery, 'file' | 'count' | 'bytes'>>> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
    if (this.error) throw outputPathError(this.file, this.error, '.ndjson');
    return { file: this.file, count: this.count, bytes: this.bytes };
  }
}

/** Options of a collection */
export interface CollectOptions extends CdpCollectParams {
  /** Aborted when the client left: the collection ends at once, incomplete */
  signal?: AbortSignal | undefined;
  /** Output budget without `out` (default {@link EVENT_OUTPUT_MAX_CHARS}) */
  maxChars?: number | undefined;
}

/**
 * Send a method and collect events while it runs: subscribed before it is
 * sent, until the `until` event (included) or the timeout, but at least
 * until the method answered. A timeout is not an error: the events so far
 * come back with `complete: false`.
 *
 * @param source - CDP connection
 * @param call - Sends the method
 * @param options - Events, until, timeout, out file
 * @returns The method's result and the events
 * @throws The method's error (nothing is collected then); CommandError for an unwritable `out`
 */
export async function collectEvents(
  source: EventSource,
  call: () => Promise<unknown>,
  options: CollectOptions
): Promise<{ result: unknown; collected: CdpCollectedEvents }> {
  const file = options.out === undefined ? undefined : await NdjsonFile.open(options.out);
  const page = new EventPage(options.maxChars ?? EVENT_OUTPUT_MAX_CHARS);
  const untilArrived = new AbortController();
  const deadline = Date.now() + options.timeoutMs;
  const names = [...new Set([...options.events, ...(options.until ? [options.until] : [])])];
  const unsubscribe = names.map((name) =>
    onPageEvent(source, name, (event) => {
      if (untilArrived.signal.aborted) return;
      if (file) file.write(event);
      else page.add(event);
      if (name === options.until) untilArrived.abort();
    })
  );
  try {
    const result = await call();
    const stop = AbortSignal.any([
      untilArrived.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    await delay(Math.max(0, deadline - Date.now()), stop);
    const complete =
      !options.signal?.aborted && (options.until === undefined || untilArrived.signal.aborted);
    unsubscribe.forEach((off) => off());
    const delivery = file
      ? await file.close()
      : {
          events: page.events,
          count: page.events.length,
          ...(page.omitted > 0 && { omitted: page.omitted }),
        };
    return { result, collected: { complete, ...delivery } };
  } catch (error) {
    unsubscribe.forEach((off) => off());
    if (file) await discard(file);
    throw error;
  }
}

/**
 * Close and delete the file of a collection that failed.
 *
 * @param file - Open file
 */
async function discard(file: NdjsonFile): Promise<void> {
  await file.close().catch(() => undefined);
  await fs.promises.rm(file.file, { force: true });
}

/** A `cdp_events` read request */
type ReadRequest = Extract<CdpEventsCommand, { action: 'read' }>;

/**
 * Event filter of a read.
 *
 * @param events - Events asked for (all when absent or empty)
 * @returns Match function
 */
function matchEvents(events: string[] | undefined): EventMatch {
  if (!events || events.length === 0) return () => true;
  const wanted = new Set(events);
  return (method) => wanted.has(method);
}

/**
 * The session's `bdg cdp --listen` buffer: events listened to are kept,
 * bounded, between commands until read or discarded. It lives as long as
 * the session (the daemon exits with it), so it is cleared when the session
 * ends.
 */
export class CdpEventListener {
  private readonly buffer: EventBuffer;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly waiters = new Set<AbortController>();

  /**
   * @param limits - Buffer caps
   * @param maxChars - Output budget of a read without `out`
   */
  constructor(
    limits: EventBufferLimits = LISTEN_LIMITS,
    private readonly maxChars = EVENT_OUTPUT_MAX_CHARS
  ) {
    this.buffer = new EventBuffer(limits);
  }

  /**
   * Buffer state for an answer.
   *
   * @returns Events listened to, buffered and dropped
   */
  state(): CdpListenState {
    return {
      listening: [...this.subscriptions.keys()],
      buffered: this.buffer.size,
      dropped: this.buffer.dropped,
    };
  }

  /**
   * Start buffering events (ones already listened to are kept as they are).
   *
   * @param source - CDP connection
   * @param events - Event names
   * @returns Buffer state
   */
  listen(source: EventSource, events: string[]): CdpListenState {
    for (const name of events) {
      if (this.subscriptions.has(name)) continue;
      const off = onPageEvent(source, name, (event) => {
        this.buffer.push(event);
        this.waiters.forEach((waiter) => waiter.abort());
      });
      this.subscriptions.set(name, off);
    }
    return this.state();
  }

  /**
   * Stop listening and discard the buffer.
   *
   * @returns Events no longer listened to and how many were discarded
   * @throws CommandError (83) when nothing was listened to
   */
  unlisten(): CdpEventsData {
    this.assertListening();
    const stopped = [...this.subscriptions.keys()];
    this.subscriptions.forEach((off) => off());
    this.subscriptions.clear();
    const discarded = this.buffer.clear(() => true);
    return { ...this.state(), stopped, discarded };
  }

  /**
   * Read buffered events: return them (within the output budget, the rest
   * staying buffered), write them to a file, or discard them; first waiting
   * up to `waitMs` for one when none is buffered. A client that left
   * during the wait takes nothing, so its events stay for the next read.
   *
   * @param request - Events, wait, clear, out
   * @param signal - Aborted when the client left (ends the wait)
   * @returns Events and buffer state
   * @throws CommandError (83) when nothing is listened to
   */
  async read(request: ReadRequest, signal?: AbortSignal): Promise<CdpEventsData> {
    this.assertListening();
    const match = matchEvents(request.events);
    const waitedOut = !(await this.waitForEvent(match, request.waitMs ?? 0, signal));
    if (signal?.aborted) return this.state();
    const delivery = await this.deliver(request, match);
    return {
      ...this.state(),
      ...delivery,
      ...(waitedOut && request.waitMs !== undefined && request.waitMs > 0 && { waitedOut }),
    };
  }

  /**
   * Take the matching events out of the buffer for an answer.
   *
   * @param request - Read request
   * @param match - Event filter
   * @returns Delivered events, or how many were cleared
   */
  private async deliver(request: ReadRequest, match: EventMatch): Promise<Partial<CdpEventsData>> {
    if (request.clear) return { cleared: this.buffer.clear(match) };
    if (request.out !== undefined) {
      const file = await NdjsonFile.open(request.out);
      this.buffer.take(match).forEach((event) => file.write(event));
      return file.close();
    }
    const page = new EventPage(this.maxChars);
    this.buffer.take(match, page);
    return {
      events: page.events,
      count: page.events.length,
      ...(page.omitted > 0 && { remaining: page.omitted }),
    };
  }

  /**
   * Wait until a matching event is buffered.
   *
   * @param match - Event filter
   * @param waitMs - Time to wait at most
   * @param signal - Ends the wait
   * @returns Whether a matching event is buffered
   */
  private async waitForEvent(
    match: EventMatch,
    waitMs: number,
    signal?: AbortSignal
  ): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    while (this.buffer.count(match) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || signal?.aborted) return false;
      const wake = new AbortController();
      this.waiters.add(wake);
      await delay(remaining, AbortSignal.any([wake.signal, ...(signal ? [signal] : [])]));
      this.waiters.delete(wake);
    }
    return true;
  }

  /**
   * @throws CommandError (83) when nothing is listened to
   */
  private assertListening(): void {
    if (this.subscriptions.size > 0) return;
    const err = cdpNotListeningError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
}
