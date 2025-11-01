import type { CDPTarget, CollectorType, NetworkRequest, ConsoleMessage, DOMData, BdgOutput, CleanupFunction } from '@/types';

import { CDPConnection } from '@/connection/cdp.js';
import { validateTarget } from '@/connection/finder.js';
import { startNetworkCollection } from '@/collectors/network.js';
import { startConsoleCollection } from '@/collectors/console.js';
import { prepareDOMCollection, collectDOM } from '@/collectors/dom.js';

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
    private port: number,
    private includeAll: boolean = false
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
        cleanup = await startNetworkCollection(this.cdp, this.networkRequests, this.includeAll);
        break;
      case 'console':
        cleanup = await startConsoleCollection(this.cdp, this.consoleLogs, this.includeAll);
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

    // Attempt to capture DOM if it's an active collector
    let domData: DOMData | undefined;
    if (this.activeCollectors.includes('dom')) {
      try {
        console.error('Capturing DOM snapshot...');
        domData = await collectDOM(this.cdp);
        console.error('DOM snapshot captured successfully');
      } catch (domError) {
        // Chrome may be closing during shutdown, ignore DOM capture failures
        console.error('Warning: DOM capture failed (Chrome may be closing):',
          domError instanceof Error ? domError.message : String(domError));
      }
    }

    // Build output (even if DOM capture failed)
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

    // Clean up collectors (skip CDP domain disabling during shutdown to avoid hanging)
    try {
      console.error('Cleaning up session...');

      // Call cleanup functions for all collectors
      this.collectors.forEach(cleanup => cleanup());
      this.collectors.clear();

      // Skip disabling CDP domains - Chrome may be dead during SIGINT shutdown
      // Just close the connection and mark as inactive
      try {
        this.cdp.close();
      } catch (closeError) {
        // Ignore close errors
      }
      this.isActive = false;

      console.error('Session cleanup complete');
    } catch (cleanupError) {
      console.error('Warning: Cleanup error:', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    }

    return output;
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

  /**
   * Get collected network requests.
   *
   * Useful for live preview of collected data without stopping the session.
   *
   * @returns Array of network requests collected so far
   */
  getNetworkRequests(): NetworkRequest[] {
    return this.networkRequests;
  }

  /**
   * Get collected console messages.
   *
   * Useful for live preview of collected data without stopping the session.
   *
   * @returns Array of console messages collected so far
   */
  getConsoleLogs(): ConsoleMessage[] {
    return this.consoleLogs;
  }

  /**
   * Get session start time.
   *
   * @returns Timestamp when session was created
   */
  getStartTime(): number {
    return this.startTime;
  }

  /**
   * Get list of active collectors.
   *
   * @returns Array of collector types that are currently active
   */
  getActiveCollectors(): CollectorType[] {
    return this.activeCollectors;
  }
}
