/**
 * Session output file management.
 *
 * Handles reading/writing session output files (preview, full, final).
 * WHY: Centralized I/O for two-tier preview system (lightweight + full data).
 */

import * as fs from 'fs';

import type { BdgOutput } from '@/types';
import { AtomicFileWriter } from '@/utils/atomicFile.js';

import {
  getSessionFilePath,
  getPartialFilePath,
  getFullFilePath,
  ensureSessionDir,
} from './paths.js';

/**
 * Write session output to the final JSON file.
 *
 * This is written once at the end of a session.
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

/**
 * Write partial session output for live preview (async version).
 *
 * Lightweight preview with metadata only for fast monitoring.
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Non-blocking version for periodic writes during collection.
 *
 * WHY: Enables `bdg peek` without stopping collection (241x smaller than full data).
 *
 * @param output - The partial BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 * @returns Promise that resolves when write completes
 */
export async function writePartialOutputAsync(
  output: BdgOutput,
  compact: boolean = false
): Promise<void> {
  const startTime = Date.now();
  ensureSessionDir();
  const partialPath = getPartialFilePath();

  // JSON.stringify is synchronous and blocks event loop - measure it separately
  const stringifyStart = Date.now();
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  const stringifyDuration = Date.now() - stringifyStart;

  // Calculate size savings when using compact mode
  const sizeKB = (jsonString.length / 1024).toFixed(1);
  if (compact) {
    // Estimate pretty-printed size (rough heuristic: 30% larger due to indentation)
    const estimatedPrettyKB = ((jsonString.length * 1.3) / 1024).toFixed(1);
    const savedKB = (parseFloat(estimatedPrettyKB) - parseFloat(sizeKB)).toFixed(1);
    console.error(
      `[PERF] Preview JSON.stringify: ${stringifyDuration}ms (${sizeKB}KB compact, saved ~${savedKB}KB)`
    );
  } else {
    console.error(`[PERF] Preview JSON.stringify: ${stringifyDuration}ms (${sizeKB}KB)`);
  }

  // Write atomically
  const ioStart = Date.now();
  await AtomicFileWriter.writeAsync(partialPath, jsonString);
  const ioDuration = Date.now() - ioStart;

  const totalDuration = Date.now() - startTime;
  console.error(
    `[PERF] Preview write: ${totalDuration}ms (stringify: ${stringifyDuration}ms, I/O: ${ioDuration}ms)`
  );
}

/**
 * Write full session output for details view (async version).
 *
 * Complete data with all request/response bodies for detailed inspection.
 * Uses atomic write (tmp file + rename) to prevent corruption.
 * Non-blocking version for periodic writes during collection.
 *
 * WHY: Enables `bdg details` to access full request/response bodies without stopping collection.
 *
 * @param output - The full BdgOutput data to write
 * @param compact - If true, use compact JSON format (no indentation)
 * @returns Promise that resolves when write completes
 */
export async function writeFullOutputAsync(
  output: BdgOutput,
  compact: boolean = false
): Promise<void> {
  const startTime = Date.now();
  ensureSessionDir();
  const fullPath = getFullFilePath();

  // JSON.stringify is synchronous and blocks event loop - measure it separately
  const stringifyStart = Date.now();
  const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
  const stringifyDuration = Date.now() - stringifyStart;

  // Calculate size savings when using compact mode
  const sizeMB = (jsonString.length / 1024 / 1024).toFixed(1);
  if (compact) {
    // Estimate pretty-printed size (rough heuristic: 30% larger due to indentation)
    const estimatedPrettyMB = ((jsonString.length * 1.3) / 1024 / 1024).toFixed(1);
    const savedMB = (parseFloat(estimatedPrettyMB) - parseFloat(sizeMB)).toFixed(1);
    console.error(
      `[PERF] Full JSON.stringify: ${stringifyDuration}ms (${sizeMB}MB compact, saved ~${savedMB}MB)`
    );
  } else {
    console.error(`[PERF] Full JSON.stringify: ${stringifyDuration}ms (${sizeMB}MB)`);
  }

  // Write atomically
  const ioStart = Date.now();
  await AtomicFileWriter.writeAsync(fullPath, jsonString);
  const ioDuration = Date.now() - ioStart;

  const totalDuration = Date.now() - startTime;
  console.error(
    `[PERF] Full write: ${totalDuration}ms (stringify: ${stringifyDuration}ms, I/O: ${ioDuration}ms)`
  );
}

/**
 * Read partial session output for live preview (lightweight metadata).
 *
 * @returns The partial BdgOutput data if file exists and is valid, null otherwise
 */
export function readPartialOutput(): BdgOutput | null {
  const partialPath = getPartialFilePath();

  if (!fs.existsSync(partialPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(partialPath, 'utf-8');
    return JSON.parse(content) as BdgOutput;
  } catch {
    return null;
  }
}

/**
 * Read full session output for details view (complete data with bodies).
 *
 * @returns The full BdgOutput data if file exists and is valid, null otherwise
 */
export function readFullOutput(): BdgOutput | null {
  const fullPath = getFullFilePath();

  if (!fs.existsSync(fullPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(content) as BdgOutput;
  } catch {
    return null;
  }
}
