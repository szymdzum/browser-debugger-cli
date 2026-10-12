/**
 * Temp files of writes still in progress, removed when the process exits
 * before the write ends (#678): Ctrl-C or SIGTERM exits through
 * `process.exit` at once, so the `catch` of the write never runs. One
 * process-level set, emptied synchronously by an `exit` listener, serves
 * every writer and every exit path without the writers knowing the CLI.
 */

import * as fs from 'fs';

import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('atomic-file');

/** Temp files of writes in progress */
const pendingTempFiles = new Set<string>();

/** Whether the `exit` listener is installed */
let exitListenerInstalled = false;

/**
 * Remove the temp files of writes still in progress (synchronously, as an
 * `exit` listener must).
 */
function removePendingTempFiles(): void {
  for (const file of pendingTempFiles) {
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      log.debug(`Failed to remove temp file ${file} on exit: ${getErrorMessage(error)}`);
    }
  }
  pendingTempFiles.clear();
}

/**
 * Track the temp file of a write until it ends: should the process exit
 * first, the file is removed.
 *
 * @param file - Path of the temp file
 * @returns Stops tracking it (call once the write has renamed or removed it)
 */
export function trackTempFile(file: string): () => void {
  if (!exitListenerInstalled) {
    exitListenerInstalled = true;
    process.on('exit', removePendingTempFiles);
  }
  pendingTempFiles.add(file);
  return () => {
    pendingTempFiles.delete(file);
  };
}
