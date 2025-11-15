/**
 * Connection module barrel export.
 *
 * Provides a clean public API for Chrome DevTools Protocol connections.
 */

// Core classes
export { CDPConnection } from './cdp.js';
export { TypedCDPConnection } from './typed-cdp.js';
export { CDPHandlerRegistry } from './handlers.js';

// Error classes
export {
  CDPConnectionError,
  CDPTimeoutError,
  ChromeLaunchError,
  getErrorMessage,
} from './errors.js';

// Functions
export { launchChrome } from './launcher.js';
export { getChromeDiagnostics } from './diagnostics.js';
export { waitForPageReady } from './pageReadiness.js';
export { reservePort } from './portReservation.js';

// Types
export type {
  CDPMessage,
  CDPTarget,
  ConnectionOptions,
  CreateOptions,
  LaunchedChrome,
  Logger,
  CleanupFunction,
} from './types.js';

export type { LaunchOptions } from './launcher.js';
export type { PageReadinessOptions } from './pageReadiness.js';
export type { PortReservation } from './portReservation.js';
export type { ChromeDiagnostics } from './diagnostics.js';
export type { CDPConfig } from './config.js';

// Configuration
export { DEFAULT_CDP_CONFIG } from './config.js';

// Re-export Protocol types for convenience
export type { Protocol } from './typed-cdp.js';
