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
import { assertFilePath, writeOutputFile } from '@/commands/shared/outputFile.js';
import { callCDP } from '@/ipc/client.js';
import { getSessionFilePath } from '@/session/paths.js';
import { applyFilters, parseFilterString } from '@/telemetry/filterDsl.js';
import { buildHAR } from '@/telemetry/har/builder.js';
import type { HAR } from '@/telemetry/har/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { VERSION } from '@/utils/version.js';

import { getNetworkRequests, validateFilterOption } from './shared.js';

const log = createLogger('network');

/**
 * HAR command options with filter support.
 */
interface HarFilterOptions extends NetworkHarCommandOptions {
  filter?: string;
}

/**
 * Generate timestamped filename for HAR export in ~/.bdg/ directory.
 *
 * A numeric suffix is added when an export from the same second exists.
 *
 * @returns Full path to HAR file in ~/.bdg/capture-YYYY-MM-DD-HHMMSS[-n].har
 */
function generateHARFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const base = `capture-${year}-${month}-${day}-${hours}${minutes}${seconds}`;
  const sessionDir = path.dirname(getSessionFilePath('OUTPUT'));
  let candidate = path.join(sessionDir, `${base}.har`);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(sessionDir, `${base}-${n}.har`);
  }
  return candidate;
}

/**
 * Chrome version of the session's browser, for the HAR `log.browser` field.
 *
 * @returns Version like "131.0.6778.86", or undefined if unavailable
 */
async function getChromeVersion(): Promise<string | undefined> {
  try {
    const response = await callCDP('Browser.getVersion', {});
    const product = (response.data?.result as { product?: string } | undefined)?.product;
    return product?.split('/')[1];
  } catch (error) {
    log.debug(`Could not read Chrome version: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * Format HAR export success message for human output.
 *
 * @param data - HAR export result data, or the HAR itself for `-` (stdout)
 * @returns Formatted success message, or the HAR as JSON
 */
function formatHARExport(
  data: { file: string; entries: number; filtered?: boolean } | HAR
): string {
  if ('log' in data) return JSON.stringify(data, null, 2);
  const filterNote = data.filtered ? ' (filtered)' : '';
  return `✓ Exported ${data.entries} requests${filterNote} to ${data.file}`;
}

/** Output path meaning "write the HAR to stdout" */
const STDOUT_PATH = '-';

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
    .addHelpText('after', '\nUse - as the output file to write the HAR to stdout.')
    .description('Export network data as HAR 1.2 format')
    .addOption(jsonOption())
    .addOption(filterDslOption)
    .action(async (outputFile: string | undefined, options: HarFilterOptions) => {
      await runCommand(
        async () => {
          let requests = await getNetworkRequests();
          let filtered = false;

          if (options.filter) {
            validateFilterOption(options.filter);
            const filters = parseFilterString(options.filter);
            const originalCount = requests.length;
            requests = applyFilters(requests, filters);
            filtered = requests.length !== originalCount;
          }

          const outputPath = outputFile ?? generateHARFilename();
          if (outputPath !== STDOUT_PATH) assertFilePath(outputPath, '.har');

          const chromeVersion = await getChromeVersion();
          const har = buildHAR(requests, {
            version: VERSION,
            ...(chromeVersion && { chromeVersion }),
          });
          if (outputPath === STDOUT_PATH) return { success: true, data: har };

          const file = await writeOutputFile(outputPath, JSON.stringify(har, null, 2), '.har');

          return {
            success: true,
            data: {
              file,
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
