/**
 * `bdg dom` command group registration.
 *
 * Each subcommand lives in its own responsibility module:
 * - `query.ts` — find elements by selector
 * - `get.ts` — read element details (semantic or raw)
 * - `screenshot.ts` — capture page/element/sequence screenshots
 * - `eval.ts` — evaluate JavaScript in the page (or an iframe)
 * - `frames.ts` — list the page's iframes
 * - `listeners.ts` — list event listeners that run for an element
 * - `layout.ts` — positions, sizes and visibility of elements
 * - `wait.ts` — wait for elements to appear, show, contain a text or go away
 *
 * Form-related commands register via `form.ts` and `formInteraction.ts`.
 * Accessibility commands register via `a11y.ts`.
 */

import type { Command } from 'commander';

import { registerA11yCommands } from '@/commands/dom/a11y.js';
import { handleDomEval } from '@/commands/dom/eval.js';
import { registerFormCommand } from '@/commands/dom/form.js';
import { handleDomFrames } from '@/commands/dom/frames.js';
import { handleDomGet } from '@/commands/dom/get.js';
import { registerLayoutCommand } from '@/commands/dom/layout.js';
import { registerListenersCommand } from '@/commands/dom/listeners.js';
import { handleDomQuery } from '@/commands/dom/query.js';
import { handleDomScreenshot } from '@/commands/dom/screenshot.js';
import { registerWaitCommand } from '@/commands/dom/wait.js';
import type {
  DomQueryCommandOptions,
  DomGetCommandOptions,
  DomScreenshotCommandOptions,
  DomEvalCommandOptions,
  DomFramesCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { integerOption, screenshotFormatOption } from '@/commands/shared/validation.js';

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
  registerListenersCommand(dom);
  registerLayoutCommand(dom);
  registerWaitCommand(dom);

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
    .option(
      '--frame <frame>',
      'Evaluate in an iframe, cross-origin ones included: index, name/id attribute, or part of the URL (see dom frames)'
    )
    .option('-j, --json', 'Output as JSON')
    .action(async (script: string, options: DomEvalCommandOptions) => {
      await handleDomEval(script, options);
    });

  program
    .command('eval', { hidden: true })
    .description('Shortcut for: bdg dom eval')
    .argument('<script>', 'JavaScript to execute')
    .option('--frame <frame>', 'Evaluate in an iframe (see dom frames)')
    .option('-j, --json', 'Output as JSON')
    .action(async (script: string, options: DomEvalCommandOptions) => {
      await handleDomEval(script, options);
    });

  dom
    .command('frames')
    .description("List the page's iframes (nested and cross-origin ones included) for eval --frame")
    .option('-j, --json', 'Output as JSON')
    .action(async (options: DomFramesCommandOptions) => {
      await handleDomFrames(options);
    });

  dom
    .command('get')
    .description('Get semantic accessibility structure (default) or raw HTML (--raw)')
    .argument(
      '[selector]',
      'CSS selector or index from query results (e.g., ".error", "#app", 0); optional with --node-id'
    )
    .option('--raw', 'Output raw HTML with all filtering options')
    .option('--all', 'Get all matches (only with --raw)')
    .option('--nth <n>', 'Get the nth match, 0-based (only with --raw)', integerOption(0))
    .option(
      '--node-id <id>',
      'Get the element with this node id (from dom query/get --raw or a11y describe; implies --raw)',
      integerOption(1)
    )
    .option('-j, --json', 'Output as JSON')
    .action(async (selector: string | undefined, options: DomGetCommandOptions) => {
      await handleDomGet(selector, options);
    });

  dom
    .command('screenshot')
    .description('Capture page or element screenshot')
    .argument('<path>', 'Output file path, or directory for --follow mode')
    .option('--selector <selector>', 'CSS selector for element capture')
    .option(
      '--index <number>',
      'Cached element index (0-based) from previous query',
      integerOption(0)
    )
    .option(
      '--format <format>',
      'Image format: png or jpeg/jpg (default: from the file extension, else png)',
      screenshotFormatOption
    )
    .option('--quality <number>', 'JPEG quality 0-100 (default: 90)', integerOption(0, 100))
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
