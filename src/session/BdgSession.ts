import { CDPConnection } from '../connection/cdp.js';
import { validateTarget } from '../connection/finder.js';
import { startNetworkCollection } from '../collectors/network.js';
import { startConsoleCollection } from '../collectors/console.js';
import { prepareDOMCollection, collectDOM } from '../collectors/dom.js';
import {
  CDPTarget,
  CollectorType,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  BdgOutput,
  CleanupFunction
} from '../types.js';

export class BdgSession {
  private cdp: CDPConnection;
  private collectors = new Map<CollectorType, CleanupFunction>();
  private startTime: number;
  private isActive = false;
  private networkRequests: NetworkRequest[] = [];
  private consoleLogs: ConsoleMessage[] = [];
  private activeCollectors: CollectorType[] = [];

  constructor(
    private target: CDPTarget,
    private port: number
  ) {
    this.cdp = new CDPConnection();
    this.startTime = Date.now();
  }

  async connect(): Promise<void> {
    // Connect with retry, auto-reconnect, and keepalive
    await this.cdp.connect(this.target.webSocketDebuggerUrl, {
      maxRetries: 3,
      autoReconnect: true,
      keepaliveInterval: 30000,
      onReconnect: async () => {
        // Re-enable collectors after reconnection
        await this.reEnableCollectors();
      }
    });

    // Validate target still exists
    const targetExists = await validateTarget(this.target.id, this.port);
    if (!targetExists) {
      this.cdp.close();
      throw new Error('Target tab closed during connection');
    }

    this.isActive = true;
  }

  async startCollector(type: CollectorType): Promise<void> {
    if (!this.isActive) {
      throw new Error('Session not active');
    }

    this.activeCollectors.push(type);
    let cleanup: CleanupFunction;

    switch (type) {
      case 'network':
        cleanup = await startNetworkCollection(this.cdp, this.networkRequests);
        break;
      case 'console':
        cleanup = await startConsoleCollection(this.cdp, this.consoleLogs);
        break;
      case 'dom':
        cleanup = await prepareDOMCollection(this.cdp);
        break;
      default:
        throw new Error(`Unknown collector type: ${type}`);
    }

    this.collectors.set(type, cleanup);
  }

  private async reEnableCollectors(): Promise<void> {
    console.error('Re-enabling collectors after reconnection...');

    // Clear old cleanup functions
    this.collectors.clear();

    // Re-enable each active collector
    for (const type of this.activeCollectors) {
      try {
        await this.startCollector(type);
      } catch (error) {
        console.error(`Failed to re-enable ${type} collector:`, error);
      }
    }
  }

  async stop(): Promise<BdgOutput> {
    if (!this.isActive) {
      throw new Error('Session not active');
    }

    console.error('Capturing final state...');

    try {
      // Capture DOM snapshot if requested
      let domData: DOMData | undefined;
      if (this.activeCollectors.includes('dom')) {
        try {
          domData = await collectDOM(this.cdp);
        } catch (error) {
          console.error('Warning: Could not capture DOM:', error instanceof Error ? error.message : String(error));
        }
      }

      // Build output
      const output: BdgOutput = {
        success: true,
        timestamp: new Date().toISOString(),
        duration: Date.now() - this.startTime,
        target: {
          url: domData?.url || this.target.url,
          title: domData?.title || this.target.title
        },
        data: {}
      };

      // Add collected data
      if (this.activeCollectors.includes('dom') && domData) {
        output.data.dom = domData;
      }
      if (this.activeCollectors.includes('network')) {
        output.data.network = this.networkRequests;
      }
      if (this.activeCollectors.includes('console')) {
        output.data.console = this.consoleLogs;
      }

      // Clean up collectors
      await this.cleanup();

      return output;
    } catch (error) {
      // Clean up even on error
      await this.cleanup();
      throw error;
    }
  }

  private async cleanup(): Promise<void> {
    // Call cleanup functions for all collectors
    this.collectors.forEach(cleanup => cleanup());
    this.collectors.clear();

    // Disable CDP domains
    await this.disableDomains();

    // Close connection
    this.cdp.close();
    this.isActive = false;
  }

  private async disableDomains(): Promise<void> {
    const disablePromises: Promise<any>[] = [];

    if (this.activeCollectors.includes('network')) {
      disablePromises.push(
        this.cdp.send('Network.disable').catch(() => {})
      );
    }
    if (this.activeCollectors.includes('console')) {
      disablePromises.push(
        this.cdp.send('Runtime.disable').catch(() => {}),
        this.cdp.send('Log.disable').catch(() => {})
      );
    }
    if (this.activeCollectors.includes('dom')) {
      disablePromises.push(
        this.cdp.send('Page.disable').catch(() => {}),
        this.cdp.send('DOM.disable').catch(() => {})
      );
    }

    await Promise.allSettled(disablePromises);
  }

  isConnected(): boolean {
    return this.isActive && this.cdp.isConnected();
  }

  getTarget(): CDPTarget {
    return this.target;
  }
}
