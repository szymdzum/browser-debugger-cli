/**
 * Session metadata management.
 *
 * Handles reading/writing session metadata (Chrome PID, CDP port, target info, etc).
 * WHY: Metadata persistence enables `bdg status` and other commands to inspect active sessions.
 */

import * as fs from 'fs';

import type { TelemetryType } from '@/types';
import { getErrorMessage } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';

const log = createLogger('session');

/**
 * Session metadata stored in ~/.bdg/session.meta.json
 */
export interface SessionMetadata {
  bdgPid: number;
  chromePid?: number | undefined;
  startTime: number;
  port: number;
  targetId?: string | undefined;
  webSocketDebuggerUrl?: string | undefined;
  activeTelemetry?: TelemetryType[] | undefined;
}

/**
 * Write session metadata atomically.
 *
 * Uses atomic write (tmp file + rename) to prevent corruption.
 *
 * @param metadata - Session metadata to write
 *
 * @example
 * ```typescript
 * writeSessionMetadata({
 *   bdgPid: process.pid,
 *   chromePid: 12345,
 *   startTime: Date.now(),
 *   port: 9222,
 *   activeCollectors: ['network', 'console', 'dom']
 * });
 * ```
 */
export function writeSessionMetadata(metadata: SessionMetadata): void {
  ensureSessionDir();
  const metaPath = getSessionFilePath('METADATA');
  AtomicFileWriter.writeSync(metaPath, JSON.stringify(metadata, null, 2));
}

/**
 * Read session metadata.
 *
 * WHY: P1 Fix #2 - Now logs warnings when metadata is corrupted.
 *
 * @param options - Options for error handling
 * @returns Session metadata if file exists and is valid, null otherwise
 *
 * @example
 * ```typescript
 * const metadata = readSessionMetadata({ warnOnCorruption: true });
 * if (metadata) {
 *   console.log(`Session started at: ${new Date(metadata.startTime)}`);
 *   console.log(`Chrome PID: ${metadata.chromePid}`);
 * }
 * ```
 */
export function readSessionMetadata(options?: {
  warnOnCorruption?: boolean;
}): SessionMetadata | null {
  const metaPath = getSessionFilePath('METADATA');

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch (error) {
    // P1 Fix #2: Warn when metadata is corrupted
    if (options?.warnOnCorruption) {
      log(`Session metadata corrupted (cannot read details): ${getErrorMessage(error)}`);
      log('Troubleshooting: Run "bdg cleanup" to remove corrupted files');
    }
    return null;
  }
}
