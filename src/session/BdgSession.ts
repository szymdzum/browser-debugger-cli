import { startConsoleCollection } from '@/collectors/console.js';
import { prepareDOMCollection, collectDOM } from '@/collectors/dom.js';
import { startNetworkCollection } from '@/collectors/network.js';
import type { NetworkCollectionOptions } from '@/collectors/network.js';
import { CDPConnection } from '@/connection/cdp.js';
import { validateTarget } from '@/connection/finder.js';
import {
  CDP_MAX_CONNECTION_RETRIES,
  CDP_KEEPALIVE_INTERVAL,
  CDP_DISCOVER_TARGETS,
} from '@/constants';
import type {
  CDPTarget,
  CollectorType,
  NetworkRequest,
  ConsoleMessage,
  DOMData,
  BdgOutput,
  CleanupFunction,
  SessionOptions,
} from '@/types';
import { filterDefined } from '@/utils/objects.js';
import { VERSION } from '@/utils/version.js';
const CAPTURING_FINAL_STATE_MESSAGE = 'Capturing final state...';
const CAPTURING_DOM_SNAPSHOT_MESSAGE = 'Capturing DOM snapshot...';
const DOM_SNAPSHOT_SUCCESS_MESSAGE = 'DOM snapshot captured successfully';
const CLEANING_UP_SESSION_MESSAGE = 'Cleaning up session...';
const SESSION_CLEANUP_COMPLETE_MESSAGE = 'Session cleanup complete';
const SESSION_NOT_ACTIVE_ERROR = 'Session not active';
const TARGET_CLOSED_ERROR = 'Target tab closed during connection';
const DOM_CAPTURE_FAILED_WARNING = 'Warning: DOM capture failed (Chrome may be closing):';
const CLEANUP_ERROR_WARNING = 'Warning: Cleanup error:';

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
  private sessionOptions: SessionOptions;

  constructor(
    private target: CDPTarget,
    private port: number,
    options: SessionOptions = {}
  ) {
    this.cdp = new CDPConnection();
    this.startTime = Date.now();
    this.sessionOptions = options;
  }

  /**
   * Connect to the CDP target and initialize session.
   *
   * We disable auto-reconnect because CLI sessions are short-lived and should
   * fail fast when the target becomes unavailable. Target validation prevents
   * race conditions where tabs close during connection setup.
   */
  async connect(): Promise<void> {
    await this.cdp.connect(this.target.webSocketDebuggerUrl, {
      maxRetries: CDP_MAX_CONNECTION_RETRIES,
      autoReconnect: false,
      keepaliveInterval: CDP_KEEPALIVE_INTERVAL,
    });

    const targetExists = await validateTarget(this.target.id, this.port);
    if (!targetExists) {
      this.cdp.close();
      throw new Error(TARGET_CLOSED_ERROR);
    }

    await this.cdp.send('Target.setDiscoverTargets', { discover: CDP_DISCOVER_TARGETS });

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
      throw new Error(SESSION_NOT_ACTIVE_ERROR);
    }

    this.activeCollectors.push(type);
    let cleanup: CleanupFunction;

    switch (type) {
      case 'network': {
        const networkOptions = this.buildNetworkCollectionOptions();
        cleanup = await startNetworkCollection(this.cdp, this.networkRequests, networkOptions);
        break;
      }
      case 'console':
        cleanup = await startConsoleCollection(
          this.cdp,
          this.consoleLogs,
          this.sessionOptions.includeAll ?? false
        );
        break;
      case 'dom':
        cleanup = await prepareDOMCollection(this.cdp);
        break;
    }

    this.collectors.set(type, cleanup);
  }

  /**
   * Stop the session and return collected telemetry.
   *
   * DOM capture errors are ignored because Chrome may be shutting down during
   * SIGINT handling. CDP domain disabling is skipped during cleanup to prevent
   * hanging when Chrome is already terminating.
   *
   * @returns Complete telemetry output with success/error status
   * @throws Error if session is not active
   */
  async stop(): Promise<BdgOutput> {
    if (!this.isActive) {
      throw new Error(SESSION_NOT_ACTIVE_ERROR);
    }

    console.error(CAPTURING_FINAL_STATE_MESSAGE);

    const domData = await this.captureDomsnapshot();
    const output = this.buildSessionOutput(domData);
    await this.performSessionCleanup();

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

  /**
   * Build network collection options from session options.
   *
   * Maps session-level configuration to network collector specific options.
   * This centralized mapping makes it easier to maintain option compatibility
   * and reduces repetitive conditional assignments.
   */
  private buildNetworkCollectionOptions(): NetworkCollectionOptions {
    return filterDefined({
      includeAll: this.sessionOptions.includeAll,
      fetchAllBodies: this.sessionOptions.fetchAllBodies,
      fetchBodiesInclude: this.sessionOptions.fetchBodiesInclude,
      fetchBodiesExclude: this.sessionOptions.fetchBodiesExclude,
      networkInclude: this.sessionOptions.networkInclude,
      networkExclude: this.sessionOptions.networkExclude,
      maxBodySize: this.sessionOptions.maxBodySize,
    }) as NetworkCollectionOptions;
  }

  /**
   * Attempt to capture final DOM snapshot.
   *
   * DOM capture failures are expected and ignored during shutdown because
   * Chrome may already be terminating when SIGINT is received. We prioritize
   * returning partial data over failing completely.
   */
  private async captureDomsnapshot(): Promise<DOMData | undefined> {
    if (!this.activeCollectors.includes('dom')) {
      return undefined;
    }

    try {
      console.error(CAPTURING_DOM_SNAPSHOT_MESSAGE);
      const domData = await collectDOM(this.cdp);
      console.error(DOM_SNAPSHOT_SUCCESS_MESSAGE);
      return domData;
    } catch (domError) {
      console.error(
        DOM_CAPTURE_FAILED_WARNING,
        domError instanceof Error ? domError.message : String(domError)
      );
      return undefined;
    }
  }

  /**
   * Build the final session output with collected data.
   */
  private buildSessionOutput(domData: DOMData | undefined): BdgOutput {
    const output: BdgOutput = {
      version: VERSION,
      success: true,
      timestamp: new Date().toISOString(),
      duration: Date.now() - this.startTime,
      target: {
        url: domData?.url ?? this.target.url,
        title: domData?.title ?? this.target.title,
      },
      data: {},
    };

    if (this.activeCollectors.includes('dom') && domData) {
      output.data.dom = domData;
    }
    if (this.activeCollectors.includes('network')) {
      output.data.network = this.networkRequests;
    }
    if (this.activeCollectors.includes('console')) {
      output.data.console = this.consoleLogs;
    }

    return output;
  }

  /**
   * Perform session cleanup with error tolerance.
   *
   * We skip CDP domain disabling and tolerate connection errors because
   * Chrome may already be dead during SIGINT shutdown. Priority is on
   * cleaning up our internal state rather than graceful CDP teardown.
   *
   * Note: Marked async for consistency with cleanup interface pattern.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async performSessionCleanup(): Promise<void> {
    try {
      console.error(CLEANING_UP_SESSION_MESSAGE);

      this.collectors.forEach((cleanup) => cleanup());
      this.collectors.clear();

      try {
        this.cdp.close();
      } catch {
        // Connection close errors are expected during shutdown
      }
      this.isActive = false;

      console.error(SESSION_CLEANUP_COMPLETE_MESSAGE);
    } catch (cleanupError) {
      console.error(
        CLEANUP_ERROR_WARNING,
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      );
    }
  }
}
