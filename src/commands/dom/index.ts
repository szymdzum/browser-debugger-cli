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
 * - `inspect.ts` — what one element looks like (styles, box, layout, child tree)
 * - `wait.ts` — wait for elements to appear, show, contain a text or go away
 *
 * Form-related commands register via `form.ts` and `formInteraction.ts`.
 * Accessibility commands register via `a11y.ts`.
 */

import { Option, type Command } from 'commander';

import { registerA11yCommands } from '@/commands/dom/a11y.js';
import { handleDomEval } from '@/commands/dom/eval.js';
import { registerFormCommand } from '@/commands/dom/form.js';
import { handleDomFrames } from '@/commands/dom/frames.js';
import { DOM_GET_DEFAULT_SELECTOR, handleDomGet } from '@/commands/dom/get.js';
import { registerInspectCommand } from '@/commands/dom/inspect.js';
import { registerLayoutCommand } from '@/commands/dom/layout.js';
import { registerListenersCommand } from '@/commands/dom/listeners.js';
import { handleDomQuery } from '@/commands/dom/query.js';
import { handleDomScreenshot } from '@/commands/dom/screenshot.js';
import { registerWaitCommand } from '@/commands/dom/wait.js';
import {
  SELECTOR_OR_INDEX_ARGUMENT,
  SELECTOR_SCOPE_HELP,
} from '@/commands/shared/commonOptions.js';
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
  registerInspectCommand(dom);
  registerWaitCommand(dom);

  dom
    .command('query')
    .description('Find elements by CSS selector')
    .argument('<selector>', 'CSS selector (e.g., ".error", "#app", "button")')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', SELECTOR_SCOPE_HELP)
    .action(async (selector: string, options: DomQueryCommandOptions) => {
      await handleDomQuery(selector, options);
    });

  dom
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option(
      '--frame <frame>',
      'Evaluate in an iframe, cross-origin ones included: index (from dom frames; 87 when stale), name/id attribute, or part of the name, id or URL'
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
    .description(
      "List the page's iframes in document order (nested and cross-origin ones included) for eval --frame"
    )
    .option('-j, --json', 'Output as JSON')
    .action(async (options: DomFramesCommandOptions) => {
      await handleDomFrames(options);
    });

  dom
    .command('get')
    .description('Get semantic accessibility structure (default) or raw HTML (--raw)')
    .argument(
      '[selectorOrIndex]',
      `${SELECTOR_OR_INDEX_ARGUMENT} (e.g. ".error", "#app", 0); default: ${DOM_GET_DEFAULT_SELECTOR}`
    )
    .option('--raw', 'Output raw HTML with all filtering options')
    .option('--full', 'Show all of the element text (default: the first 500 characters)')
    .option('--all', 'Get all matches (only with --raw)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .addOption(new Option('--nth <n>', 'Alias of --index').argParser(integerOption(0)).hideHelp())
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
    .argument(
      '[selector]',
      'Element to capture: CSS selector or index from a query (same as --selector / --index)'
    )
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
    .action(
      async (path: string, target: string | undefined, options: DomScreenshotCommandOptions) => {
        await handleDomScreenshot(path, target, options);
      }
    );
}
