import type { NavigationEvent } from '@/telemetry/navigation.js';
import type {
  BdgOutput,
  CDPTarget,
  ConsoleMessage,
  DOMData,
  NetworkRequest,
  TelemetryType,
} from '@/types';
import { VERSION } from '@/utils/version.js';

export class TelemetryStore {
  readonly networkRequests: NetworkRequest[] = [];
  readonly consoleMessages: ConsoleMessage[] = [];
  readonly navigationEvents: NavigationEvent[] = [];

  domData: DOMData | null = null;
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

  setNavigationResolver(resolver: (() => number) | null): void {
    this.getCurrentNavigationId = resolver;
  }

  setDomData(data: DOMData | null): void {
    this.domData = data;
  }

  buildOutput(partial = false): BdgOutput {
    const duration = Date.now() - this.sessionStartTime;
    const data: BdgOutput['data'] = {};

    if (this.networkRequests.length > 0) {
      data.network = this.networkRequests;
    }
    if (this.consoleMessages.length > 0) {
      data.console = this.consoleMessages;
    }
    if (this.domData) {
      data.dom = this.domData;
    }

    return {
      version: VERSION,
      success: true,
      timestamp: new Date(this.sessionStartTime).toISOString(),
      duration,
      target: {
        url: this.targetInfo?.url ?? '',
        title: this.targetInfo?.title ?? '',
      },
      data,
      ...(partial && { partial: true }),
    };
  }
}
