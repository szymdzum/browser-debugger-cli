/**
 * Session management module - centralized exports.
 *
 * Re-exports all session-related utilities from focused submodules.
 * WHY: Single import point maintains backwards compatibility while improving internal structure.
 */

// Path management
export {
  getSessionDir,
  getSessionFilePath,
  getWorkerSocketPath,
  getPartialFilePath,
  getFullFilePath,
  ensureSessionDir,
  type SessionFileType,
} from './paths.js';

// Process utilities
export { isProcessAlive, killChromeProcess } from './process.js';

// Lock management
export { acquireSessionLock, releaseSessionLock } from './lock.js';

// PID management
export { writePid, readPid, cleanupPidFile } from './pid.js';

// Metadata management
export { writeSessionMetadata, readSessionMetadata, type SessionMetadata } from './metadata.js';

// Chrome PID cache
export { writeChromePid, readChromePid, clearChromePid } from './chrome.js';

// Output file I/O
export {
  writeSessionOutput,
  writePartialOutputAsync,
  writeFullOutputAsync,
  readPartialOutput,
  readFullOutput,
} from './output.js';

// Cleanup operations
export { cleanupSession, cleanupStaleSession } from './cleanup.js';
