import WebSocket from 'ws';
import { CDPMessage, ConnectionOptions } from '../types.js';

export class CDPConnection {
  private ws: WebSocket | null = null;
  private messageId = 0;
  private pendingMessages = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private nextHandlerId = 0;
  private eventHandlers = new Map<string, Map<number, (params: any) => void>>();

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
  private onReconnect?: () => Promise<void>;

  async connect(wsUrl: string, options: ConnectionOptions = {}): Promise<void> {
    const {
      maxRetries = 3,
      autoReconnect = false,
      onReconnect
    } = options;

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
          await new Promise(resolve => setTimeout(resolve, delay));
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

      this.ws.on('close', async (code, reason) => {
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
      });

      this.ws.on('pong', () => {
        this.missedPongs = 0;
        if (this.pongTimeout) {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = null;
        }
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message: CDPMessage = JSON.parse(data.toString());

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
              handlers.forEach(handler => handler(message.params));
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
    console.error(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    await new Promise(resolve => setTimeout(resolve, delay));

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

  async send(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to browser');
    }

    const id = ++this.messageId;
    const message: CDPMessage = { id, method, params };

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
        timeout
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  on(event: string, handler: (params: any) => void): number {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Map());
    }
    const handlerId = ++this.nextHandlerId;
    this.eventHandlers.get(event)!.set(handlerId, handler);
    return handlerId;
  }

  off(event: string, handlerId: number): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handlerId);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.eventHandlers.delete(event);
    } else {
      this.eventHandlers.clear();
    }
  }

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

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
