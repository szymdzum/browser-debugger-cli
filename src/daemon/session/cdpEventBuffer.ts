/**
 * Bounded storage for CDP events: the `bdg cdp --listen` buffer, and the
 * output budget that keeps `--collect` and `--events` answers small enough
 * for an agent to read (event params can be megabytes: trace chunks, heap
 * snapshot chunks, response headers of a busy page).
 */

import type { CdpEventOutput, CdpEventRecord } from '@/ipc/protocol/cdpEventTypes.js';
import { capLength } from '@/utils/strings.js';

/** Characters of events an answer without `--out` carries (as `dom eval --json`) */
export const EVENT_OUTPUT_MAX_CHARS = 20_000;

/** Caps of an event buffer */
export interface EventBufferLimits {
  /** Events kept at most */
  maxEvents: number;
  /** Characters of event JSON kept at most */
  maxBytes: number;
}

/** Caps of the `--listen` buffer: 1000 events, 10 MB of event JSON */
export const LISTEN_LIMITS: EventBufferLimits = { maxEvents: 1000, maxBytes: 10 * 1024 * 1024 };

/** Picks the events a read is about, by name */
export type EventMatch = (method: string) => boolean;

/**
 * Length of an event's JSON (its NDJSON line without the newline).
 *
 * @param event - Event
 * @returns Characters
 */
export function eventJsonLength(event: CdpEventRecord): number {
  return JSON.stringify(event).length;
}

/**
 * Events for one answer, in order, within a character budget. Once an event
 * does not fit, it and every later one are omitted, so what an answer leaves
 * out is always the end. A first event that alone is over the budget is
 * still returned, its params cut to the start of their JSON text.
 */
export class EventPage {
  readonly events: CdpEventOutput[] = [];
  /** Events offered that were not taken */
  omitted = 0;
  private used = 0;

  /**
   * @param maxChars - Character budget of the events' JSON
   */
  constructor(private readonly maxChars: number) {}

  /**
   * Take an event if it fits.
   *
   * @param event - Event
   * @returns Whether it was taken
   */
  add(event: CdpEventRecord): boolean {
    const size = eventJsonLength(event);
    if (this.omitted === 0 && this.used + size <= this.maxChars) {
      this.events.push(event);
      this.used += size;
      return true;
    }
    if (this.events.length === 0 && this.omitted === 0) {
      this.events.push(cutParams(event, this.maxChars));
      this.used = this.maxChars;
      return true;
    }
    this.omitted++;
    return false;
  }
}

/**
 * An event whose params are replaced by the start of their JSON text.
 *
 * @param event - Event over the budget
 * @param maxChars - Characters of params JSON kept
 * @returns Event with string params and `truncatedFrom`
 */
function cutParams(event: CdpEventRecord, maxChars: number): CdpEventOutput {
  const json = JSON.stringify(event.params) ?? 'null';
  const kept = Math.max(0, maxChars - (eventJsonLength({ ...event, params: '' }) + 40));
  const { text } = capLength(json, kept);
  return { ...event, params: text, truncatedFrom: json.length };
}

/** A buffered event and its JSON length */
interface Entry {
  event: CdpEventRecord;
  size: number;
}

/**
 * Events in arrival order, dropping the oldest beyond an event count or a
 * character budget (and an event alone over the budget), and counting what
 * it dropped.
 */
export class EventBuffer {
  private entries: Entry[] = [];
  private totalBytes = 0;
  private droppedCount = 0;

  /**
   * @param limits - Event and character caps
   */
  constructor(private readonly limits: EventBufferLimits = LISTEN_LIMITS) {}

  /** Events buffered */
  get size(): number {
    return this.entries.length;
  }

  /** Characters of event JSON buffered */
  get bytes(): number {
    return this.totalBytes;
  }

  /** Events dropped at the caps so far */
  get dropped(): number {
    return this.droppedCount;
  }

  /**
   * Add an event, dropping the oldest while over a cap.
   *
   * @param event - Event
   */
  push(event: CdpEventRecord): void {
    const size = eventJsonLength(event);
    this.entries.push({ event, size });
    this.totalBytes += size;
    while (
      this.entries.length > this.limits.maxEvents ||
      (this.totalBytes > this.limits.maxBytes && this.entries.length > 0)
    ) {
      const oldest = this.entries.shift();
      this.totalBytes -= oldest?.size ?? 0;
      this.droppedCount++;
    }
  }

  /**
   * Buffered events a read is about.
   *
   * @param match - Event filter
   * @returns How many
   */
  count(match: EventMatch): number {
    return this.entries.filter((entry) => match(entry.event.method)).length;
  }

  /**
   * Take matching events out of the buffer: all of them, or those a page
   * takes (the rest stay for the next read).
   *
   * @param match - Event filter
   * @param page - Output budget the events go to
   * @returns Events taken, in order
   */
  take(match: EventMatch, page?: EventPage): CdpEventRecord[] {
    const taken: CdpEventRecord[] = [];
    this.entries = this.entries.filter((entry) => {
      if (!match(entry.event.method)) return true;
      if (page && !page.add(entry.event)) return true;
      taken.push(entry.event);
      this.totalBytes -= entry.size;
      return false;
    });
    return taken;
  }

  /**
   * Discard matching events.
   *
   * @param match - Event filter
   * @returns How many were discarded
   */
  clear(match: EventMatch): number {
    return this.take(match).length;
  }
}
