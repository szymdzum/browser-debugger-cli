/**
 * IPC Module
 *
 * Public API for inter-process communication between the CLI and the daemon.
 *
 * Organized into layers:
 * - Client API (high-level functions for CLI commands)
 * - Session messages (lifecycle and query types)
 * - Protocol (session command schemas and type guards)
 * - Transport (low-level socket communication)
 * - Validation (response validation utilities)
 */

export * from './client.js';

export * from './session/index.js';

export * from './protocol/index.js';

export { validateIPCResponse } from './utils/responseValidator.js';
