/**
 * Session metadata management.
 *
 * Handles reading/writing session metadata (Chrome PID, CDP port, target info, etc).
 * WHY: Metadata persistence enables `bdg status` and other commands to inspect active sessions.
 */

import * as fs from 'fs';

import type { CollectorType } from '@/types';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';

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
  activeCollectors?: CollectorType[] | undefined;
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
 * @returns Session metadata if file exists and is valid, null otherwise
 *
 * @example
 * ```typescript
 * const metadata = readSessionMetadata();
 * if (metadata) {
 *   console.log(`Session started at: ${new Date(metadata.startTime)}`);
 *   console.log(`Chrome PID: ${metadata.chromePid}`);
 * }
 * ```
 */
export function readSessionMetadata(): SessionMetadata | null {
  const metaPath = getSessionFilePath('METADATA');

  if (!fs.existsSync(metaPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(metaPath, 'utf-8');
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}
