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

// Public client API
export * from './client.js';

// Session message types
export * from './session/index.js';

// Protocol types (worker commands)
export * from './protocol/index.js';

// Validation utilities (re-exported from utils for public API)
export { validateIPCResponse } from './utils/responseValidator.js';

// Note: transport/ is internal and not exported (used by client.ts)
// Note: other utils are internal and not exported (except validateIPCResponse)
