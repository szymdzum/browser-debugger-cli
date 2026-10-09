/**
 * Protocol-owned DTOs for CDP event collection (`bdg cdp --collect`,
 * `--listen`, `--events`, `--unlisten`).
 *
 * Events are buffered in the daemon and returned with the response, since
 * IPC is request/response. Only events of the session page's own target
 * are kept: ones Chrome sends for attached child sessions (out-of-process
 * iframes, workers after `Target.setAutoAttach` with `flatten`) carry a
 * `sessionId` that `bdg cdp` cannot send commands to, so they are left out.
 */

/** A CDP event as bdg reports it (also one NDJSON line of `--out`) */
export interface CdpEventRecord {
  /** Event name, e.g. `Fetch.requestPaused` */
  method: string;
  /** Event parameters as Chrome sent them */
  params: unknown;
  /** When bdg received it (epoch ms) */
  ts: number;
}

/**
 * An event in output: its params whole, or (for one event over the output
 * budget) the start of their JSON text with the original length.
 */
export interface CdpEventOutput extends CdpEventRecord {
  /** Length of the event's JSON, set when `params` was cut to the start of its JSON text */
  truncatedFrom?: number;
}

/** What `bdg cdp <Method> --collect` asks the daemon to collect */
export interface CdpCollectParams {
  /** Events to collect (subscribed before the method is sent) */
  events: string[];
  /** Event that ends the collection (collected too) */
  until?: string;
  /** How long to collect from the subscription on (at least until the method answered) */
  timeoutMs: number;
  /** Absolute path of an NDJSON file to write the events to, instead of returning them */
  out?: string;
}

/** Where the events of a collection or a read went */
export interface CdpEventsDelivery {
  /** Events in this response (absent with `out`) */
  events?: CdpEventOutput[];
  /** Events delivered: in `events` (incl. one cut) or written to `file` */
  count: number;
  /** Absolute path of the NDJSON file written (with `out`) */
  file?: string;
  /** Bytes written to `file` */
  bytes?: number;
}

/** Events a `--collect` gathered */
export interface CdpCollectedEvents extends CdpEventsDelivery {
  /** False when `until` did not arrive within the timeout (the events are partial) */
  complete: boolean;
  /** Matching events left out of `events` to stay within the output budget (use `out`) */
  omitted?: number;
  /** Events not written to `file` because the disk fell too far behind (complete is false) */
  dropped?: number;
}

/** `cdp_events` request: start listening, read the buffer, or stop */
export type CdpEventsCommand =
  | { action: 'listen'; events: string[] }
  | {
      action: 'read';
      /** Only these events (all buffered events when absent) */
      events?: string[];
      /** Wait up to this long for a matching event when none is buffered */
      waitMs?: number;
      /** Discard the matching events instead of returning them */
      clear?: boolean;
      /** Absolute path of an NDJSON file to write the events to */
      out?: string;
    }
  | { action: 'unlisten' };

/** State of the session's event buffer, in every `cdp_events` answer */
export interface CdpListenState {
  /** Events listened to, in the order they were added */
  listening: string[];
  /** Events in the buffer (after this request) */
  buffered: number;
  /** Events dropped at the buffer's caps (oldest first) since listening started */
  dropped: number;
}

/** `cdp_events` answer */
export interface CdpEventsData extends CdpListenState, Partial<CdpEventsDelivery> {
  /** Matching events still buffered (left for the next read by the output budget) */
  remaining?: number;
  /** Events discarded by `clear` */
  cleared?: number;
  /** Events no longer listened to (unlisten) */
  stopped?: string[];
  /** Buffered events discarded by unlisten */
  discarded?: number;
  /** Read with `waitMs`: no matching event arrived in time */
  waitedOut?: boolean;
}
