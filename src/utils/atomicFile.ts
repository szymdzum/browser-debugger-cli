import * as crypto from 'crypto';
import * as fs from 'fs';

import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { trackTempFile } from '@/utils/tempFiles.js';

const log = createLogger('atomic-file');

/**
 * Atomic file operations using tmp-file-then-rename pattern.
 *
 * Provides safe file writing that prevents corruption from interrupted writes
 * or concurrent access by using unique temporary files and atomic rename operation.
 */
export class AtomicFileWriter {
  /**
   * Generate a unique temporary file path.
   *
   * Uses process PID and random UUID to ensure uniqueness across concurrent processes.
   *
   * @param filePath - Target file path
   * @returns Unique temporary file path
   */
  private static getTempPath(filePath: string): string {
    const uuid = crypto.randomUUID();
    return `${filePath}.${process.pid}.${uuid}.tmp`;
  }

  /**
   * Write data to a file atomically (synchronous).
   *
   * Creates a unique temporary file, writes the data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state and prevents corruption
   * from concurrent writes by different processes.
   *
   * @param filePath - Target file path
   * @param data - Data to write
   * @param options - Write options
   * @throws Error if write operation fails
   */
  static writeSync(
    filePath: string,
    data: string,
    options: { encoding?: BufferEncoding } = {}
  ): void {
    const tmpPath = this.getTempPath(filePath);

    try {
      fs.writeFileSync(tmpPath, data, { encoding: options.encoding ?? 'utf-8' });
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tmpPath);
      } catch (cleanupError) {
        log.debug(`Failed to cleanup temp file ${tmpPath}: ${getErrorMessage(cleanupError)}`);
      }
      throw error;
    }
  }

  /**
   * Write data to a file atomically (asynchronous).
   *
   * Creates a unique temporary file (exclusively: an existing file or symlink at that path is an
   * error, never written through), writes the data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state and prevents corruption
   * from concurrent writes by different processes. A symlink at the target path is replaced, not
   * followed.
   *
   * @param filePath - Target file path
   * @param data - Data to write
   * @param options - Write options (`mode`: permissions of the new file, less the umask)
   * @returns Promise that resolves when write completes
   * @throws Error if write operation fails
   */
  static async writeAsync(
    filePath: string,
    data: string,
    options: { encoding?: BufferEncoding; mode?: number } = {}
  ): Promise<void> {
    await this.writeThroughTemp(filePath, (tmpPath) =>
      fs.promises.writeFile(tmpPath, data, {
        encoding: options.encoding ?? 'utf-8',
        flag: 'wx',
        ...(options.mode !== undefined && { mode: options.mode }),
      })
    );
  }

  /**
   * Write binary data (Buffer) to a file atomically (asynchronous).
   *
   * Creates a unique temporary file, writes the binary data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state and prevents corruption
   * from concurrent writes by different processes.
   *
   * Useful for screenshots, images, and other binary file exports.
   *
   * @param filePath - Target file path
   * @param buffer - Binary data to write
   * @returns Promise that resolves when write completes
   * @throws Error if write operation fails
   */
  static async writeBufferAsync(filePath: string, buffer: Buffer): Promise<void> {
    await this.writeThroughTemp(filePath, (tmpPath) => fs.promises.writeFile(tmpPath, buffer));
  }

  /**
   * Write a temp file and rename it over the target. The temp file is removed
   * when the write fails, and also when the process exits before the write
   * ends (Ctrl-C, SIGTERM; #678).
   *
   * @param filePath - Target file path
   * @param write - Writes the temp file
   * @throws Error if write operation fails
   */
  private static async writeThroughTemp(
    filePath: string,
    write: (tmpPath: string) => Promise<void>
  ): Promise<void> {
    const tmpPath = this.getTempPath(filePath);
    const untrack = trackTempFile(tmpPath);

    try {
      await write(tmpPath);
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tmpPath);
      } catch (cleanupError) {
        log.debug(`Failed to cleanup temp file ${tmpPath}: ${getErrorMessage(cleanupError)}`);
      }
      throw error;
    } finally {
      untrack();
    }
  }
}
