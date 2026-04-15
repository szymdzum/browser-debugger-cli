/**
 * `bdg dom` command group registration.
 *
 * Each subcommand lives in its own responsibility module:
 * - `query.ts` — find elements by selector
 * - `get.ts` — read element details (semantic or raw)
 * - `screenshot.ts` — capture page/element/sequence screenshots
 * - `eval.ts` — evaluate JavaScript in the page
 *
 * Form-related commands register via `form.ts` and `formInteraction.ts`.
 * Accessibility commands register via `a11y.ts`.
 */

import type { Command } from 'commander';

import { registerA11yCommands } from '@/commands/dom/a11y.js';
import { handleDomEval } from '@/commands/dom/eval.js';
import { registerFormCommand } from '@/commands/dom/form.js';
import { handleDomGet } from '@/commands/dom/get.js';
import { handleDomQuery } from '@/commands/dom/query.js';
import { handleDomScreenshot } from '@/commands/dom/screenshot.js';
import type {
  DomQueryCommandOptions,
  DomGetCommandOptions,
  DomScreenshotCommandOptions,
  DomEvalCommandOptions,
} from '@/commands/shared/optionTypes.js';

/**
 * Register DOM telemetry commands on the root Commander program.
 */
export function registerDomCommands(program: Command): void {
  const dom = program
    .command('dom')
    .description('DOM inspection and manipulation')
    .enablePositionalOptions();

  registerA11yCommands(dom);
  registerFormCommand(dom);

  dom
    .command('query')
    .description('Find elements by CSS selector')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomQueryCommandOptions) => {
      await handleDomQuery(selector, options);
    });

  dom
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option('-j, --json', 'Output as JSON')
    .action(async (script: string, options: DomEvalCommandOptions) => {
      await handleDomEval(script, options);
    });

  dom
    .command('get')
    .description('Get semantic accessibility structure (default) or raw HTML (--raw)')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('--raw', 'Output raw HTML with all filtering options')
    .option('--all', 'Get all matches (only with --raw)')
    .option('--nth <n>', 'Get nth match (only with --raw)', parseInt)
    .option('--node-id <id>', 'Use nodeId directly (only with --raw)', parseInt)
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string, options: DomGetCommandOptions) => {
      await handleDomGet(selector, options);
    });

  dom
    .command('screenshot')
    .description('Capture page or element screenshot')
    .argument('<path>', 'Output file path, or directory for --follow mode')
    .option('--selector <selector>', 'CSS selector for element capture')
    .option('--index <number>', 'Cached element index (0-based) from previous query', parseInt)
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
