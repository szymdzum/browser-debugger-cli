import * as fs from 'fs';

/**
 * Atomic file operations using tmp-file-then-rename pattern.
 *
 * Provides safe file writing that prevents corruption from interrupted writes
 * or concurrent access by using a temporary file and atomic rename operation.
 */
export class AtomicFileWriter {
  /**
   * Write data to a file atomically (synchronous).
   *
   * Creates a temporary file, writes the data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state.
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
    const tmpPath = filePath + '.tmp';

    try {
      // Write to temporary file first
      fs.writeFileSync(tmpPath, data, { encoding: options.encoding ?? 'utf-8' });

      // Atomically rename to target path
      fs.renameSync(tmpPath, filePath);
    } catch (error) {
      // Clean up temporary file on error
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
   * Creates a temporary file, writes the data, then atomically renames it to the target path.
   * This ensures the target file is never in a partially written state.
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
    const tmpPath = filePath + '.tmp';

    try {
      // Write to temporary file first
      await fs.promises.writeFile(tmpPath, data, { encoding: options.encoding ?? 'utf-8' });

      // Atomically rename to target path
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      // Clean up temporary file on error
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }
}
