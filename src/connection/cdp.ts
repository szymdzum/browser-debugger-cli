import WebSocket from 'ws';

import type { CDPMessage, ConnectionOptions } from '@/types';

/**
 * Chrome DevTools Protocol WebSocket connection manager.
 *
 * Handles bidirectional communication with Chrome via CDP:
 * - Request/response correlation with message IDs
 * - Event subscription and handling
 * - Connection lifecycle (connect, reconnect, keepalive)
 * - Graceful error handling and cleanup
 */
export class CDPConnection {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingMessages = new Map<
    number,
    {
      resolve: (value: unknown) => void; // CDP responses vary by method, typed at call site
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();
  private nextHandlerId = 0;
  private eventHandlers = new Map<string, Map<number, (params: unknown) => void>>(); // Event params typed at call site

  // Keepalive state
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private missedPongs = 0;
  private readonly MAX_MISSED_PONGS = 3;

  // Reconnection state
  private wsUrl = '';
  private autoReconnect = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private isIntentionallyClosed = false;
  private onReconnect?: (() => Promise<void>) | undefined;

  /**
   * Connect to Chrome via WebSocket.
   *
   * @param wsUrl - WebSocket debugger URL from CDP target
   * @param options - Connection configuration options
   * @throws Error if connection fails after all retries
   */
  async connect(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const { maxRetries = 3, autoReconnect = false, onReconnect } = options;

    this.wsUrl = wsUrl;
    this.autoReconnect = autoReconnect;
    this.onReconnect = onReconnect;
    this.isIntentionallyClosed = false;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.attemptConnection(wsUrl, options);
        this.reconnectAttempts = 0;
        return;
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          console.error(`Connection attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed to connect after ${maxRetries} attempts: ${lastError?.message}`);
  }

  private attemptConnection(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const timeout = options.timeout ?? 10000;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.ws?.close();
      }, timeout);

      this.ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.startKeepalive(options.keepaliveInterval ?? 30000);
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(connectTimeout);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        void (async () => {
          this.stopKeepalive();

          if (this.isIntentionallyClosed) {
            return;
          }

          console.error(`WebSocket closed: ${code} - ${reason.toString()}`);

          // Reject all pending messages
          this.pendingMessages.forEach((pending) => {
            clearTimeout(pending.timeout);
            pending.reject(new Error('WebSocket connection closed'));
          });
          this.pendingMessages.clear();

          // Attempt reconnection if enabled
          if (this.autoReconnect && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            await this.attemptReconnection();
          }
        })();
      });

      this.ws.on('pong', () => {
        this.missedPongs = 0;
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
      });

      this.ws.on('message', (rawData: WebSocket.RawData) => {
        try {
          let dataString: string;
          if (typeof rawData === 'string') {
            dataString = rawData;
          } else if (Buffer.isBuffer(rawData)) {
            dataString = rawData.toString('utf8');
          } else if (Array.isArray(rawData)) {
            dataString = Buffer.concat(rawData).toString('utf8');
          } else {
            console.error('Unexpected data type in CDP message');
            return;
          }
          const message: CDPMessage = JSON.parse(dataString) as CDPMessage;

          // Handle responses
          if (message.id !== undefined) {
            const pending = this.pendingMessages.get(message.id);
            if (pending) {
              this.pendingMessages.delete(message.id);
              clearTimeout(pending.timeout);
              if (message.error) {
                pending.reject(new Error(message.error.message));
              } else {
                pending.resolve(message.result);
              }
            }
          }

          // Handle events
          if (message.method) {
            const handlers = this.eventHandlers.get(message.method);
            if (handlers) {
              handlers.forEach((handler) => handler(message.params));
            }
          }
        } catch (error) {
          console.error('Failed to parse CDP message:', error);
        }
      });
    });
  }

  private async attemptReconnection(): Promise<void> {
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
    console.error(
      `Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.attemptConnection(this.wsUrl);
      this.reconnectAttempts = 0;
      console.error('Reconnected successfully');

      // Re-enable domains
      if (this.onReconnect) {
        await this.onReconnect();
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
    }
  }

  private startKeepalive(interval: number): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.missedPongs++;

        if (this.missedPongs >= this.MAX_MISSED_PONGS) {
          console.error('Connection lost: no pong received');
          this.ws.close(1001, 'No pong received');
          return;
        }

        this.ws.ping();

        this.pongTimeout = setTimeout(() => {
          console.error('Pong timeout');
        }, 5000);
      }
    }, interval);
  }

  private stopKeepalive(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Get the CDP port from the WebSocket URL.
   *
   * @returns CDP port number
   * @throws Error if not connected or URL is invalid
   */
  getPort(): number {
    if (!this.wsUrl) {
      throw new Error('Not connected - no WebSocket URL available');
    }

    try {
      const url = new URL(this.wsUrl);
      return parseInt(url.port, 10);
    } catch {
      throw new Error(`Invalid WebSocket URL: ${this.wsUrl}`);
    }
  }

  /**
   * Send a CDP command and wait for the response.
   *
   * @param method - CDP method name (e.g., 'Page.navigate', 'DOM.getDocument')
   * @param params - Method parameters
   * @param sessionId - Optional session ID for commands sent to specific targets
   * @returns Promise resolving to the command result
   * @throws Error if not connected or command times out (30s)
   *
   * @remarks
   * Return type is `unknown` because CDP response structures vary by method.
   * Callers should type-assert the result based on the specific method called.
   */
  async send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to browser');
    }

    const id = ++this.messageId;
    const message: CDPMessage & { sessionId?: string } = { id, method, params };

    // Add sessionId if provided (for commands sent to specific targets)
    if (sessionId) {
      message.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingMessages.get(id);
        if (pending) {
          this.pendingMessages.delete(id);
          reject(new Error(`Command timeout: ${method}`));
        }
      }, 30000);

      this.pendingMessages.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });

      const socket = this.ws;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        clearTimeout(timeout);
        this.pendingMessages.delete(id);
        reject(new Error('Not connected to browser'));
        return;
      }

      socket.send(JSON.stringify(message));
    });
  }

  /**
   * Register an event handler for CDP events.
   *
   * @param event - CDP event name (e.g., 'Network.requestWillBeSent')
   * @param handler - Callback function to handle the event
   * @returns Handler ID for later removal with off()
   *
   * @remarks
   * Handler parameter type uses generics for type safety. Callers should provide typed
   * event parameter interfaces (e.g., `CDPNetworkRequestParams`) at call site.
   */
  on<T = unknown>(event: string, handler: (params: T) => void): number {
    let handlersForEvent = this.eventHandlers.get(event);
    if (!handlersForEvent) {
      handlersForEvent = new Map();
      this.eventHandlers.set(event, handlersForEvent);
    }
    const handlerId = ++this.nextHandlerId;
    // Cast handler to match storage signature - safe because we invoke with unknown params
    handlersForEvent.set(handlerId, handler as (params: unknown) => void);
    return handlerId;
  }

  /**
   * Remove a specific event handler.
   *
   * @param event - CDP event name
   * @param handlerId - Handler ID returned from on()
   */
  off(event: string, handlerId: number): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handlerId);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Remove all event handlers for a specific event or all events.
   *
   * @param event - Optional event name. If omitted, removes all handlers for all events.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }

  /**
   * Close the WebSocket connection and clean up resources.
   *
   * @param code - WebSocket close code (default: 1000 for normal closure)
   * @param reason - Human-readable close reason
   */
  close(code = 1000, reason = 'Normal closure'): void {
    this.isIntentionallyClosed = true;
    this.autoReconnect = false;
    this.stopKeepalive();

    // Clear all pending messages
    this.pendingMessages.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    });
    this.pendingMessages.clear();

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }

    this.removeAllListeners();
  }

  /**
   * Check if the WebSocket connection is open and ready.
   *
   * @returns True if connected and ready to send/receive
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
