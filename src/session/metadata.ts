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
 * Options for reading session metadata.
 */
export interface ReadSessionMetadataOptions {
  /** Log a warning when metadata cannot be parsed */
  warnOnCorruption?: boolean;
  /** Delete corrupted metadata file to self-heal for subsequent runs */
  selfHealOnCorruption?: boolean;
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
export function readSessionMetadata(options?: ReadSessionMetadataOptions): SessionMetadata | null {
  const metaPath = getSessionFilePath('METADATA');

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch (error) {
    if (options?.warnOnCorruption) {
      log.info(`Session metadata corrupted (cannot read details): ${getErrorMessage(error)}`);
      log.info('Troubleshooting: Run "bdg cleanup" to remove corrupted files');
    }
    if (options?.selfHealOnCorruption) {
      try {
        fs.rmSync(metaPath, { force: true });
        log.info('Removed corrupted session metadata file');
      } catch (deleteError) {
        log.debug(`Failed to remove corrupted metadata: ${getErrorMessage(deleteError)}`);
      }
    }
    return null;
  }
}
