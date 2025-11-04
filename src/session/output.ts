/**
 * Session output file management.
 *
 * Handles writing final session output to disk.
 * Note: Live preview/details now use IPC streaming instead of file writes.
 */

import type { BdgOutput } from '@/types';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import { getSessionFilePath, ensureSessionDir } from './paths.js';

/**
 * Write session output to the final JSON file.
 *
 * This is written once at the end of a session.
 * Note: Preview/details data is now accessed via IPC streaming during collection.
 *
 * @param output - The BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 */
export function writeSessionOutput(output: BdgOutput, compact: boolean = false): void {
  ensureSessionDir();
  const outputPath = getSessionFilePath('OUTPUT');
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  AtomicFileWriter.writeSync(outputPath, jsonString);
}
