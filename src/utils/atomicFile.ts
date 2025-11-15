import * as crypto from 'crypto';
import * as fs from 'fs';

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
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Write data to a file atomically (asynchronous).
   *
   * Creates a unique temporary file, writes the data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state and prevents corruption
   * from concurrent writes by different processes.
   *
   * @param filePath - Target file path
   * @param data - Data to write
   * @param options - Write options
   * @returns Promise that resolves when write completes
   * @throws Error if write operation fails
   */
  static async writeAsync(
    filePath: string,
    data: string,
    options: { encoding?: BufferEncoding } = {}
  ): Promise<void> {
    const tmpPath = this.getTempPath(filePath);

    try {
      await fs.promises.writeFile(tmpPath, data, { encoding: options.encoding ?? 'utf-8' });
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
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
    const tmpPath = this.getTempPath(filePath);

    try {
      await fs.promises.writeFile(tmpPath, buffer);
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}
