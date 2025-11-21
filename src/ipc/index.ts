/**
 * IPC Module
 *
 * Public API for inter-process communication between CLI, daemon, and worker.
 *
 * Organized into layers:
 * - Client API (high-level functions for CLI commands)
 * - Session messages (lifecycle and query types)
 * - Protocol (worker command schemas and type guards)
 * - Transport (low-level socket communication)
 * - Validation (response validation utilities)
 */

export * from './client.js';

export * from './session/index.js';

export * from './protocol/index.js';

export {
  validateIPCResponse,
  extractIPCData,
  requireIPCData,
  type IPCDataResult,
} from './utils/responseValidator.js';
