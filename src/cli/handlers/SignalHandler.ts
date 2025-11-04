import { cleanupSession } from '@/session/cleanup.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Interface for shutdown callback
 */
export interface SignalHandlerOptions {
  onShutdown: () => Promise<void>;
}

/**
 * Manages process signal handling for graceful shutdown
 */
export class SignalHandler {
  private isHandling = false;

  constructor(private options: SignalHandlerOptions) {}

  /**
   * Register signal handlers for graceful shutdown.
   */
  register(): void {
    const handler = (signal: string): void => this.handleSignal(signal);

    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));

    process.on('unhandledRejection', this.handleUnhandledRejection);
    process.on('uncaughtException', this.handleUncaughtException);
  }

  /**
   * Unregister all signal handlers.
   */
  unregister(): void {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  }

  /**
   * Handle shutdown signals (SIGINT, SIGTERM)
   */
  private handleSignal(signal: string): void {
    if (this.isHandling) {
      return;
    }

    this.isHandling = true;
    console.error(`\nReceived ${signal}, shutting down gracefully...`);

    this.unregister();

    void (async () => {
      try {
        await this.options.onShutdown();
        // onShutdown calls process.exit(), so we should never reach here
      } catch (error) {
        console.error('Fatal error during shutdown:', error);
        process.exit(EXIT_CODES.SIGNAL_HANDLER_ERROR);
      }
    })();
  }

  /**
   * Handle unhandled promise rejections
   */
  private handleUnhandledRejection = (reason: unknown): void => {
    console.error('Unhandled rejection:', reason);
    console.error('Cleaning up session files...');
    try {
      cleanupSession();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  };

  /**
   * Handle uncaught exceptions
   */
  private handleUncaughtException = (error: Error): void => {
    console.error('Uncaught exception:', error);
    console.error('Cleaning up session files...');
    try {
      cleanupSession();
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }
    process.exit(EXIT_CODES.UNHANDLED_EXCEPTION);
  };
}
