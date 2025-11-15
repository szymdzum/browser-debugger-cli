/**
 * Session Service
 *
 * Abstraction over session file operations.
 * Prevents handlers from coupling to filesystem implementation details.
 */

import { cleanupSession } from '@/session/cleanup.js';
import { acquireDaemonLock, releaseDaemonLock } from '@/session/lock.js';
import { readSessionMetadata, writeSessionMetadata } from '@/session/metadata.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPid, writePid } from '@/session/pid.js';
import { isProcessAlive } from '@/session/process.js';

/**
 * Interface for session file operations.
 *
 * Provides a clean boundary between handlers and session storage,
 * making it easy to mock for testing and swap implementations later.
 */
export interface ISessionService {
  /**
   * Read worker process PID from session file.
   *
   * @returns PID if session exists and file is valid, null otherwise
   */
  readPid(): number | null;

  /**
   * Write worker process PID to session file.
   *
   * @param pid - Worker process ID
   */
  writePid(pid: number): void;

  /**
   * Read session metadata.
   *
   * @param options - Read options
   * @returns Session metadata if file exists and is valid, null otherwise
   */
  readMetadata(options?: { warnOnCorruption?: boolean }): SessionMetadata | null;

  /**
   * Write session metadata.
   *
   * @param data - Session metadata to write
   */
  writeMetadata(data: SessionMetadata): void;

  /**
   * Check if a process is alive.
   *
   * @param pid - Process ID to check
   * @returns True if process is running, false otherwise
   */
  isProcessAlive(pid: number): boolean;

  /**
   * Clean up all session files.
   */
  cleanup(): void;

  /**
   * Acquire daemon lock to prevent concurrent sessions.
   *
   * @throws Error if lock cannot be acquired
   */
  acquireLock(): void;

  /**
   * Release daemon lock to allow new sessions.
   */
  releaseLock(): void;

  /**
   * Get path to session file.
   *
   * @param fileType - Type of session file
   * @returns Absolute path to session file
   */
  getFilePath(
    fileType: 'OUTPUT' | 'METADATA' | 'DAEMON_SOCKET' | 'DAEMON_PID' | 'PID' | 'CHROME_PID'
  ): string;
}

/**
 * Default implementation of session service using file system.
 */
export class SessionService implements ISessionService {
  readPid(): number | null {
    return readPid();
  }

  writePid(pid: number): void {
    writePid(pid);
  }

  readMetadata(options?: { warnOnCorruption?: boolean }): SessionMetadata | null {
    return readSessionMetadata(options);
  }

  writeMetadata(data: SessionMetadata): void {
    writeSessionMetadata(data);
  }

  isProcessAlive(pid: number): boolean {
    return isProcessAlive(pid);
  }

  cleanup(): void {
    cleanupSession();
  }

  acquireLock(): void {
    acquireDaemonLock();
  }

  releaseLock(): void {
    releaseDaemonLock();
  }

  getFilePath(
    fileType: 'OUTPUT' | 'METADATA' | 'DAEMON_SOCKET' | 'DAEMON_PID' | 'PID' | 'CHROME_PID'
  ): string {
    return getSessionFilePath(fileType);
  }
}
