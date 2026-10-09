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
 * Most bytes a collection's `--out` file may have waiting to be written
 * (64 MB). CDP events cannot be paused, so past this the events are dropped
 * and counted, rather than piling up in the daemon's memory.
 */
const MAX_PENDING_WRITE_BYTES = 64 * 1024 * 1024;

/** Flags of a temp file: created new (never an existing file or a symlink) */
const TEMP_FILE_FLAGS =
  fs.constants.O_WRONLY |
  fs.constants.O_CREAT |
  fs.constants.O_EXCL |
  (fs.constants.O_NOFOLLOW ?? 0);

/** Temp files created by this daemon, for unique names */
let tempFileCount = 0;

/**
 * An NDJSON file events are written to, one per line. They go to a new temp
 * file next to the target, renamed over it only on {@link commit}, so a
 * failed collection never truncates or deletes a file the user had there.
 */
class NdjsonFile {
  count = 0;
  bytes = 0;
  /** Events dropped while too much was waiting to be written */
  dropped = 0;
  private error: Error | undefined;

  private constructor(
    readonly file: string,
    private readonly temp: string,
    private readonly stream: fs.WriteStream,
    private readonly maxPendingBytes: number
  ) {
    stream.on('error', (error) => {
      this.error = error;
    });
  }

  /**
   * Create the temp file of a target, with the target's directory.
   *
   * @param file - Absolute path of the target
   * @param maxPendingBytes - Bytes allowed to wait for the disk before events are dropped
   * @returns The open file
   * @throws CommandError naming the path when it cannot be written
   */
  static async open(file: string, maxPendingBytes = MAX_PENDING_WRITE_BYTES): Promise<NdjsonFile> {
    const temp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${++tempFileCount}.tmp`
    );
    try {
      const target = await fs.promises.stat(file).catch(() => undefined);
      if (target?.isDirectory()) throw Object.assign(new Error('directory'), { code: 'EISDIR' });
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const handle = await fs.promises.open(temp, TEMP_FILE_FLAGS, 0o666);
      return new NdjsonFile(file, temp, handle.createWriteStream(), maxPendingBytes);
    } catch (error) {
      throw outputPathError(file, error, '.ndjson');
    }
  }

  /**
   * Append an event, or drop it while too much waits to be written.
   *
   * @param event - Event
   * @returns Whether it was written
   */
  write(event: CdpEventRecord): boolean {
    if (this.stream.writableLength >= this.maxPendingBytes) {
      this.dropped++;
      return false;
    }
    const line = `${JSON.stringify(event)}\n`;
    this.stream.write(line);
    this.count++;
    this.bytes += Buffer.byteLength(line);
    return true;
  }

  /**
   * Append events, waiting for the disk whenever its buffer is full.
   *
   * @param events - Events
   */
  async writeAll(events: CdpEventRecord[]): Promise<void> {
    for (const event of events) {
      const line = `${JSON.stringify(event)}\n`;
      this.count++;
      this.bytes += Buffer.byteLength(line);
      if (!this.stream.write(line) && !this.error) {
        await new Promise<void>((resolve) => {
          this.stream.once('drain', resolve);
          this.stream.once('error', () => resolve());
        });
      }
    }
  }

  /**
   * Flush and close the temp file, then rename it over the target.
   *
   * @returns What was written
   * @throws CommandError naming the path when a write or the rename failed (the temp file is removed)
   */
  async commit(): Promise<Required<Pick<CdpEventsDelivery, 'file' | 'count' | 'bytes'>>> {
    try {
      await this.end();
      if (this.error) throw this.error;
      await fs.promises.rename(this.temp, this.file);
    } catch (error) {
      await fs.promises.rm(this.temp, { force: true });
      throw outputPathError(this.file, error, '.ndjson');
    }
    return { file: this.file, count: this.count, bytes: this.bytes };
  }

  /**
   * Close and remove the temp file, leaving the target as it was.
   */
  async discard(): Promise<void> {
    await this.end();
    await fs.promises.rm(this.temp, { force: true });
  }

  /**
   * Flush and close the stream (it reports errors through {@link error}).
   */
  private async end(): Promise<void> {
    if (this.stream.closed) return;
    await new Promise<void>((resolve) => {
      this.stream.once('close', resolve);
      this.stream.end();
    });
  }
}

/** Options of a collection */
export interface CollectOptions extends CdpCollectParams {
  /** Aborted when the client left: the collection ends at once, incomplete */
  signal?: AbortSignal | undefined;
  /** Output budget without `out` (default {@link EVENT_OUTPUT_MAX_CHARS}) */
  maxChars?: number | undefined;
  /** Bytes the `out` file may have waiting to be written before events are dropped */
  maxPendingBytes?: number | undefined;
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
  const file =
    options.out === undefined
      ? undefined
      : await NdjsonFile.open(options.out, options.maxPendingBytes);
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
    unsubscribe.forEach((off) => off());
    const complete =
      !options.signal?.aborted &&
      !file?.dropped &&
      (options.until === undefined || untilArrived.signal.aborted);
    const delivery = file
      ? { ...(await file.commit()), ...(file.dropped > 0 && { dropped: file.dropped }) }
      : {
          events: page.events,
          count: page.events.length,
          ...(page.omitted > 0 && { omitted: page.omitted }),
        };
    return { result, collected: { complete, ...delivery } };
  } catch (error) {
    unsubscribe.forEach((off) => off());
    await file?.discard();
    throw error;
  }
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
   * staying buffered), write them to a file (taken out of the buffer only
   * once the file is in place), or discard them; first waiting
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
      const events = this.buffer.peek(match);
      try {
        await file.writeAll(events);
      } catch (error) {
        await file.discard();
        throw error;
      }
      const written = await file.commit();
      this.buffer.remove(new Set(events));
      return written;
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
