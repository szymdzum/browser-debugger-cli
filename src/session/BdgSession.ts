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

/**
 * Manages a browser debugging session.
 *
 * Encapsulates the lifecycle of collecting telemetry from a browser tab:
 * - CDP connection management
 * - Collector initialization and cleanup
 * - Data aggregation
 * - Graceful shutdown with final snapshot
 */
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
    // Connect with retry and keepalive (no auto-reconnect for CLI use)
    await this.cdp.connect(this.target.webSocketDebuggerUrl, {
      maxRetries: 3,
      autoReconnect: false,
      keepaliveInterval: 30000
    });

    // Validate target still exists
    const targetExists = await validateTarget(this.target.id, this.port);
    if (!targetExists) {
      this.cdp.close();
      throw new Error('Target tab closed during connection');
    }

    // Enable Target domain to receive targetDestroyed events
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });

    this.isActive = true;
  }

  /**
   * Start a specific data collector.
   *
   * @param type - Type of collector to start ('dom', 'network', or 'console')
   * @throws Error if session is not active
   */
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

  /**
   * Stop the session and return collected telemetry.
   *
   * Captures final DOM snapshot, aggregates all collected data,
   * and performs cleanup of CDP connection and collectors.
   *
   * @returns Complete telemetry output with success/error status
   * @throws Error if session is not active
   */
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
    const disablePromises: Promise<any>[] = [];  // CDP responses vary, using any for simplicity

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

  /**
   * Check if the session is active and connected.
   *
   * @returns True if session is active and CDP connection is open
   */
  isConnected(): boolean {
    return this.isActive && this.cdp.isConnected();
  }

  /**
   * Get the CDP target information for this session.
   *
   * @returns Target information (URL, title, ID, etc.)
   */
  getTarget(): CDPTarget {
    return this.target;
  }

  /**
   * Get the CDP connection instance.
   *
   * Useful for registering additional event handlers or sending custom commands.
   *
   * @returns CDP connection instance
   */
  getCDP(): CDPConnection {
    return this.cdp;
  }
}
