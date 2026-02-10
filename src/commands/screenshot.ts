/**
 * Top-level screenshot command - alias for `dom screenshot`.
 *
 * Provides convenient access to screenshot functionality without
 * requiring the `dom` prefix.
 */

import type { Command } from 'commander';

import { handleDomScreenshot } from '@/commands/dom/index.js';
import type { DomScreenshotCommandOptions } from '@/commands/shared/optionTypes.js';

/**
 * Register the top-level screenshot command as an alias for dom screenshot.
 */
export function registerScreenshotCommand(program: Command): void {
  program
    .command('screenshot')
    .description('Capture page or element screenshot (alias for dom screenshot)')
    .argument('<path>', 'Output file path, or directory for --follow mode')
    .option(
      '--chrome-ws-url <url>',
      'Connect directly to Chrome via WebSocket URL (bypasses daemon)'
    )
    .option('--selector <selector>', 'CSS/Playwright selector for element capture')
    .option('--format <format>', 'Image format: png or jpeg (default: png)')
    .option('--quality <number>', 'JPEG quality 0-100 (default: 90)', parseInt)
    .option('--no-full-page', 'Capture viewport only (default: full page)')
    .option('--no-resize', 'Disable auto-resize (full resolution)')
    .option('--scroll <selector>', 'Scroll element into view before capture')
    .option('-f, --follow', 'Continuous capture mode to directory')
    .option('--interval <ms>', 'Capture interval for --follow (default: 1000)')
    .option('--limit <count>', 'Max frames for --follow')
    .option('-j, --json', 'Output as JSON')
    .action(async (path: string, options: DomScreenshotCommandOptions) => {
      await handleDomScreenshot(path, options);
    });
}
