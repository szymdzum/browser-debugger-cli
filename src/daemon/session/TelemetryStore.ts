import type { DialogInfo } from '@/ipc/protocol/domTypes.js';
import type { NavigationEvent } from '@/telemetry/navigation.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type {
  CDPTarget,
  ConsoleMessage,
  NetworkRequest,
  TelemetryType,
  WebSocketConnection,
} from '@/types.js';
import { dialogConsoleText } from '@/ui/messages/commands.js';

export class TelemetryStore {
  readonly networkRequests: NetworkRequest[] = [];
  /** Requests still in flight, keyed by CDP requestId */
  readonly pendingNetworkRequests = new Map<string, PendingRequest>();
  readonly consoleMessages: ConsoleMessage[] = [];
  readonly navigationEvents: NavigationEvent[] = [];
  readonly websocketConnections: WebSocketConnection[] = [];
  /** JavaScript dialogs accepted during the session */
  readonly dialogs: DialogInfo[] = [];

  activeTelemetry: TelemetryType[] = [];
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
   * Record an accepted dialog, and show it among the console messages when
   * console telemetry is collected (it is otherwise invisible: bdg accepts it
   * before anyone could see it).
   *
   * @param dialog - Dialog type and text
   */
  recordDialog(dialog: DialogInfo): void {
    this.dialogs.push(dialog);
    if (!this.activeTelemetry.includes('console')) return;
    this.consoleMessages.push({
      type: 'info',
      text: dialogConsoleText(dialog),
      timestamp: Date.now(),
      source: 'other',
      ...(this.getCurrentNavigationId && { navigationId: this.getCurrentNavigationId() }),
    });
  }
}
