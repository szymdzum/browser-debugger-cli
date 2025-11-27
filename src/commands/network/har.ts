/**
 * HAR export command for network data.
 *
 * Exports collected network requests to HAR 1.2 format.
 * Supports filtering with DevTools-compatible DSL.
 */

import * as fs from 'fs';
import * as path from 'path';

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { NetworkHarCommandOptions } from '@/commands/shared/optionTypes.js';
import { getSessionFilePath } from '@/session/paths.js';
import { applyFilters, parseFilterString, validateFilterString } from '@/telemetry/filterDsl.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import { CommandError } from '@/ui/errors/index.js';
import { operationFailedError } from '@/ui/messages/errors.js';
import { AtomicFileWriter } from '@/utils/atomicFile.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { VERSION } from '@/utils/version.js';

import { getNetworkRequests } from './shared.js';

/**
 * HAR command options with filter support.
 */
interface HarFilterOptions extends NetworkHarCommandOptions {
  filter?: string;
}

/**
 * Generate timestamped filename for HAR export in ~/.bdg/ directory.
 *
 * @returns Full path to HAR file in ~/.bdg/capture-YYYY-MM-DD-HHMMSS.har
 */
function generateHARFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const filename = `capture-${year}-${month}-${day}-${hours}${minutes}${seconds}.har`;
  const sessionDir = path.dirname(getSessionFilePath('OUTPUT'));
  return path.join(sessionDir, filename);
}

/**
 * Format HAR export success message for human output.
 *
 * @param data - HAR export result data
 * @returns Formatted success message
 */
function formatHARExport(data: { file: string; entries: number; filtered?: boolean }): string {
  const filterNote = data.filtered ? ' (filtered)' : '';
  return `✓ Exported ${data.entries} requests${filterNote} to ${data.file}`;
}

/**
 * Option for filter DSL.
 */
const filterDslOption = new Option(
  '--filter <dsl>',
  'Filter requests using DevTools DSL (e.g., "status-code:>=400")'
);

/**
 * Register HAR export command.
 *
 * @param networkCmd - Network parent command
 */
export function registerHarCommand(networkCmd: Command): void {
  networkCmd
    .command('har [output-file]')
    .description('Export network data as HAR 1.2 format')
    .addOption(jsonOption())
    .addOption(filterDslOption)
    .action(async (outputFile: string | undefined, options: HarFilterOptions) => {
      await runCommand(
        async () => {
          let requests = await getNetworkRequests();
          let filtered = false;

          if (options.filter) {
            const validation = validateFilterString(options.filter);
            if (!validation.valid) {
              const err = operationFailedError(
                'validate filter',
                validation.suggestion ?? 'Check filter syntax'
              );
              throw new CommandError(
                validation.error,
                { suggestion: err.suggestion },
                EXIT_CODES.INVALID_ARGUMENTS
              );
            }

            const filters = parseFilterString(options.filter);
            const originalCount = requests.length;
            requests = applyFilters(requests, filters);
            filtered = requests.length !== originalCount;
          }

          const outputPath = outputFile ?? generateHARFilename();

          const dir = path.dirname(outputPath);
          if (dir !== '.' && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const har = buildHAR(requests, {
            version: VERSION,
          });

          await AtomicFileWriter.writeAsync(outputPath, JSON.stringify(har, null, 2));

          return {
            success: true,
            data: {
              file: outputPath,
              entries: har.log.entries.length,
              filtered,
            },
          };
        },
        options,
        formatHARExport
      );
    });
}
