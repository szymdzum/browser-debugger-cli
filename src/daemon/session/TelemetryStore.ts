import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { DialogInfo } from '@/ipc/protocol/domTypes.js';
import type { TrackedDownload } from '@/telemetry/downloads.js';
import type { NavigationEvent } from '@/telemetry/navigation.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type { NetworkEvictions } from '@/telemetry/networkRetention.js';
import type {
  CDPTarget,
  ConsoleMessage,
  NetworkRequest,
  TelemetryType,
  WebSocketConnection,
} from '@/types.js';
import { dialogConsoleText } from '@/ui/messages/commands.js';

export class TelemetryStore {
  /**
   * Finished requests, oldest first: the newest are kept, so the session's
   * `networkEvictions.requestsDropped` oldest ones are gone
   */
  readonly networkRequests: NetworkRequest[] = [];
  /** Requests dropped and response bodies evicted at the capture limits */
  readonly networkEvictions: NetworkEvictions = { requestsDropped: 0, bodiesEvicted: 0 };
  /** Requests still in flight, keyed by CDP requestId */
  readonly pendingNetworkRequests = new Map<string, PendingRequest>();
  readonly consoleMessages: ConsoleMessage[] = [];
  /**
   * Console messages dropped at the limit, oldest first: the index of
   * `consoleMessages[i]` in the session is `consoleDropped + i`
   */
  consoleDropped = 0;
  /** Console events received so far (daemon side, in arrival order) */
  private consoleReceived = 0;
  /** Which received event each console message came from (1-based) */
  private readonly consoleReceipts = new WeakMap<ConsoleMessage, number>();
  readonly navigationEvents: NavigationEvent[] = [];
  readonly websocketConnections: WebSocketConnection[] = [];
  /** JavaScript dialogs accepted during the session */
  readonly dialogs: DialogInfo[] = [];
  /** Downloads that began during the session, oldest first, updated as they progress */
  readonly downloads: TrackedDownload[] = [];
  /** Set while downloads do not go where bdg meant them to (refused, or not redirected) */
  downloadsWarning: string | undefined = undefined;

  activeTelemetry: TelemetryType[] = [];
  /** When the page's renderer crashed (epoch ms); undefined while the page is alive */
  pageCrashedAt: number | undefined;
  getCurrentNavigationId: (() => number) | null = null;
  sessionStartTime = Date.now();
  targetInfo: CDPTarget | null = null;

  resetSessionStart(): void {
    this.sessionStartTime = Date.now();
  }

  setTargetInfo(target: CDPTarget | null): void {
    this.targetInfo = target;
  }

  setNavigationResolver(navigationId: (() => number) | null): void {
    this.getCurrentNavigationId = navigationId;
  }

  /**
   * Note that a console event arrived, before its message is added: the
   * message may be added later (its objects expanded first) and is kept in
   * the page's timestamp order, so neither its position nor Chrome's clock
   * tells when bdg received it.
   *
   * @returns Records the event's message once it is added
   */
  receiveConsoleMessage(): (message: ConsoleMessage) => void {
    const receipt = ++this.consoleReceived;
    return (message) => this.consoleReceipts.set(message, receipt);
  }

  /**
   * Console events received so far, a mark for {@link receivedAfter}.
   *
   * @returns Count that only grows
   */
  consoleMessagesReceived(): number {
    return this.consoleReceived;
  }

  /**
   * Whether a console message's event arrived after a mark.
   *
   * @param message - Message
   * @param mark - {@link consoleMessagesReceived} at some moment
   * @returns False for a message received by then or not recorded
   */
  receivedAfter(message: ConsoleMessage, mark: number): boolean {
    return (this.consoleReceipts.get(message) ?? 0) > mark;
  }

  /**
   * Record an accepted dialog, and show it among the console messages when
   * console telemetry is collected (it is otherwise invisible: bdg accepts it
   * before anyone could see it), dropping the oldest message at the limit.
   *
   * @param dialog - Dialog type and text
   */
  recordDialog(dialog: DialogInfo): void {
    this.dialogs.push(dialog);
    if (!this.activeTelemetry.includes('console')) return;
    if (this.consoleMessages.length >= MAX_CONSOLE_MESSAGES) {
      this.consoleMessages.shift();
      this.consoleDropped++;
    }
    const message: ConsoleMessage = {
      type: 'info',
      text: dialogConsoleText(dialog),
      timestamp: Date.now(),
      source: 'other',
      ...(this.getCurrentNavigationId && { navigationId: this.getCurrentNavigationId() }),
    };
    this.receiveConsoleMessage()(message);
    this.consoleMessages.push(message);
  }
}
