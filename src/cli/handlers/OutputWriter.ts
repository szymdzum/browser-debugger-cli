import type { BdgOutput } from '@/types';
import { writeSessionOutput } from '@/utils/session.js';

/**
 * Handles writing session output to files and console
 */
export class OutputWriter {
  /**
   * Write session output to file and stdout.
   *
   * @param output - The output payload to write
   * @param exitCode - 0 for success, 1 for error
   * @param compact - If true, use compact JSON format (no indentation)
   */
  writeSessionOutput(output: BdgOutput, exitCode: 0 | 1, compact: boolean = false): void {
    // Write output to file for 'bdg stop' to read
    try {
      const message = exitCode === 0 ? 'Writing session output...' : 'Writing error output...';
      console.error(message);
      writeSessionOutput(output, compact);
      const successMessage =
        exitCode === 0
          ? 'Session output written successfully'
          : 'Error output written successfully';
      console.error(successMessage);
    } catch (writeError) {
      const errorMessage =
        exitCode === 0 ? 'Failed to write session output:' : 'Failed to write error output:';
      console.error(errorMessage, writeError);
      console.error('Write error details:', writeError);
    }

    // Output to stdout (for foreground use)
    const jsonString = compact ? JSON.stringify(output) : JSON.stringify(output, null, 2);
    console.log(jsonString);
  }
}
