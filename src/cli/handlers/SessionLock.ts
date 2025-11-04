import { cleanupSession } from '@/session/cleanup.js';
import { acquireSessionLock } from '@/session/lock.js';
import { readPid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';
import type { CollectorType } from '@/types';
import { normalizeUrl } from '@/utils/url.js';
import { validateCollectorTypes } from '@/utils/validation.js';

/**
 * Handles session lock acquisition and validation
 */
export class SessionLock {
  /**
   * Acquire session lock and validate inputs
   *
   * @param url - Target URL to monitor
   * @param collectors - Collector types to enable
   * @returns Normalized URL
   * @throws Error if session already running or validation fails
   */
  static acquire(url: string, collectors: CollectorType[]): string {
    const existingPid = readPid();

    // Check for stale session before trying to acquire lock
    if (existingPid && !isProcessAlive(existingPid)) {
      console.error(`Found stale session (PID ${existingPid} not running)`);
      console.error('Cleaning up stale session files...');
      cleanupSession();
      console.error('Stale session cleaned up');
    }

    if (!acquireSessionLock()) {
      const currentPid = readPid();
      throw new Error(`Session already running (PID ${currentPid}). Stop it with: bdg stop`);
    }

    // Validate collector types
    validateCollectorTypes(collectors);

    // Normalize URL - add http:// if no protocol specified
    return normalizeUrl(url);
  }
}
