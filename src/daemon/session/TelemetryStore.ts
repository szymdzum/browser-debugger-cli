import type { NavigationEvent } from '@/telemetry/navigation.js';
import type { PendingRequest } from '@/telemetry/network.js';
import type {
  CDPTarget,
  ConsoleMessage,
  NetworkRequest,
  TelemetryType,
  WebSocketConnection,
} from '@/types.js';

export class TelemetryStore {
  readonly networkRequests: NetworkRequest[] = [];
  /** Requests still in flight, keyed by CDP requestId */
  readonly pendingNetworkRequests = new Map<string, PendingRequest>();
  readonly consoleMessages: ConsoleMessage[] = [];
  readonly navigationEvents: NavigationEvent[] = [];
  readonly websocketConnections: WebSocketConnection[] = [];

  activeTelemetry: TelemetryType[] = [];
  getCurrentNavigationId: (() => number) | null = null;
  getDomVersion: (() => number) | null = null;
  sessionStartTime = Date.now();
  targetInfo: CDPTarget | null = null;

  resetSessionStart(): void {
    this.sessionStartTime = Date.now();
  }

  setTargetInfo(target: CDPTarget | null): void {
    this.targetInfo = target;
  }

  setNavigationResolver(
    navigationId: (() => number) | null,
    domVersion: (() => number) | null = null
  ): void {
    this.getCurrentNavigationId = navigationId;
    this.getDomVersion = domVersion;
  }
}
