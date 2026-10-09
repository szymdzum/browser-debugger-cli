/**
 * A screenshot changes the page's emulation for its capture (pixel ratio,
 * touch, viewport, scrollbars) and puts it back once the capture ended. Its
 * client may be gone long before that: interrupted (Ctrl-C), killed, or timed
 * out by the daemon's command timeout. Page commands therefore run only once
 * the captures before them are done, restore included, so no command, from
 * any client, sees the capture's emulation. Commands that read only the
 * telemetry run at once. The wait counts toward the command's own timeout
 * (30 s), like any time the command takes.
 */

import type { CommandName } from '@/ipc/index.js';
import { settledWithin } from '@/runtime/dom/evalHelpers.js';
import { createLogger } from '@/ui/logging/index.js';

const log = createLogger('session');

/** Commands that read only what the session collected, never the page */
export const TELEMETRY_READS: readonly CommandName[] = [
  'session_peek',
  'session_details',
  'session_status',
  'session_har_data',
  'session_network_headers',
  'cdp_events',
];

const IGNORES_CAPTURE: ReadonlySet<CommandName> = new Set(TELEMETRY_READS);

/**
 * How long a page command waits for a capture before it runs anyway. A
 * capture of a very tall page takes a few seconds; one that never ends (CDP
 * calls have no timeout) must not stall the session. A capture waits for the
 * one before it without this limit (bounded by its command timeout): run
 * during it, it would record that capture's emulation as the page's own and
 * put that back.
 */
export const CAPTURE_WAIT_MS = 15_000;

/** Command that changes the page's emulation until it ends */
const CAPTURE_COMMAND: CommandName = 'dom_screenshot';

/**
 * Orders page commands after the captures before them.
 */
export class CaptureGate {
  private capture: Promise<void> | undefined;

  /**
   * @param waitMs - How long a command waits for a capture at most
   */
  constructor(private readonly waitMs = CAPTURE_WAIT_MS) {}

  /**
   * Run a command: at once when it reads only the telemetry, else once the
   * capture running before it has ended (or, unless it is a capture itself,
   * {@link waitMs} passed). A
   * capture is waited for by the commands after it until it ends, however it
   * ends.
   *
   * @param name - Command name
   * @param command - The command
   * @returns Its result
   */
  run<T>(name: CommandName, command: () => Promise<T>): Promise<T> {
    if (IGNORES_CAPTURE.has(name)) return command();
    const isCapture = name === CAPTURE_COMMAND;
    const result = this.captureEnded(isCapture).then(command);
    if (isCapture) this.track(result);
    return result;
  }

  /**
   * Wait for the running capture, if any: until it ends for a capture, else
   * at most {@link waitMs}.
   *
   * @param isCapture - Whether the waiting command is a capture
   */
  private async captureEnded(isCapture: boolean): Promise<void> {
    const capture = this.capture;
    if (!capture) return;
    if (isCapture) return capture;
    const ended = await settledWithin(capture, this.waitMs);
    if (!ended.settled) log.info(`Capture still running after ${this.waitMs} ms; not waiting`);
  }

  /**
   * Make a capture the one later commands wait for.
   *
   * @param result - The capture's result
   */
  private track(result: Promise<unknown>): void {
    const ended: Promise<void> = result.then(
      () => undefined,
      () => undefined
    );
    this.capture = ended;
    void ended.then(() => {
      if (this.capture === ended) this.capture = undefined;
    });
  }
}
