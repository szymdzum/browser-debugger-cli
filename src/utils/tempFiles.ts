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

const log = createLogger('temp-files');

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

/** A temp file created and tracked by {@link createTrackedTempFile} */
export interface TrackedTempFile {
  /** Its file descriptor, open for writing */
  fd: number;
  /** Stops tracking it (call once the write has renamed or removed it) */
  untrack: () => void;
}

/**
 * Create a temp file and track it until its write ends: should the process
 * exit first, the file is removed. It is created synchronously, so no exit
 * can come between its creation and its tracking.
 *
 * @param file - Path of the temp file
 * @param flags - Open flags (they must create the file exclusively)
 * @param mode - Mode of the new file (less the umask)
 * @returns The open file and its untrack function
 * @throws The file-system error of the create (nothing is tracked then)
 */
export function createTrackedTempFile(file: string, flags: number, mode = 0o666): TrackedTempFile {
  const fd = fs.openSync(file, flags, mode);
  if (!exitListenerInstalled) {
    exitListenerInstalled = true;
    process.on('exit', removePendingTempFiles);
  }
  pendingTempFiles.add(file);
  return {
    fd,
    untrack: () => {
      pendingTempFiles.delete(file);
    },
  };
}

/**
 * Number of temp files tracked now (writes in progress), for diagnostics.
 *
 * @returns Count of tracked temp files
 */
export function pendingTempFileCount(): number {
  return pendingTempFiles.size;
}
