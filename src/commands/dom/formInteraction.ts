/**
 * Form interaction commands for filling inputs, clicking buttons, and submitting forms.
 *
 * These commands delegate the CDP work to the daemon's worker via IPC. The CLI
 * never opens its own CDP connection — the worker owns the single persistent
 * CDP session and runs the full fill/click/submit sequence (including event
 * subscriptions for network-stability waits) on behalf of the CLI.
 */

import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { type PressKeyResult, type ScrollResult } from '@/commands/dom/formFillHelpers/index.js';
import type { SubmitResult } from '@/commands/dom/formSubmitHelpers.js';
import type { FillResult, ClickResult } from '@/commands/dom/reactEventHelpers.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  FillCommandOptions,
  ClickCommandOptions,
  SubmitCommandOptions,
  PressKeyCommandOptions,
  ScrollCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { domClick, domFill, domPressKey, domScroll, domSubmit } from '@/ipc/client.js';
import { CommandError } from '@/ui/errors/index.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { internalError } from '@/ui/messages/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Register form interaction commands.
 *
 * @param program - Commander program instance
 *
 * @remarks
 * Registers the following commands:
 * - `bdg dom fill <selector> <value>` - Fill form fields
 * - `bdg dom click <selector>` - Click elements
 * - `bdg dom submit <selector>` - Submit forms with smart waiting
 */
export function registerFormInteractionCommands(program: Command): void {
  const domCommand = program.commands.find((cmd) => cmd.name() === 'dom');

  if (!domCommand) {
    const err = internalError('DOM command group not found');
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }

  domCommand
    .command('fill')
    .description('Fill a form field with a value (React-compatible, waits for stability)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .argument('<value>', 'Value to fill')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', parseInt)
    .option('--no-blur', 'Do not blur after filling (keeps focus on element)')
    .option('--no-wait', 'Skip waiting for network stability after fill')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, value: string, options: FillCommandOptions) => {
      await runCommand(
        async () => {
          const target = await DomElementResolver.getInstance().resolve(
            selectorOrIndex,
            options.index
          );

          if (!target.success) {
            return {
              success: false,
              error: target.error ?? 'Failed to resolve element target',
              exitCode: target.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
            };
          }

          const response = await domFill({
            selector: target.selector,
            value,
            ...(target.index !== undefined && { index: target.index }),
            ...(options.blur !== undefined && { blur: options.blur }),
            wait: options.wait !== false,
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to fill element',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to fill element',
              exitCode: result.error?.includes('not found')
                ? EXIT_CODES.RESOURCE_NOT_FOUND
                : EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion:
                  result.suggestion ??
                  'Verify the selector matches a fillable element (input, textarea, select)',
              },
            };
          }

          return { success: true, data: result };
        },
        options,
        formatFillOutput
      );
    });

  domCommand
    .command('click')
    .description('Click an element and wait for stability (accepts selector or index)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', parseInt)
    .option('--no-wait', 'Skip waiting for network stability after click')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: ClickCommandOptions) => {
      await runCommand(
        async () => {
          const target = await DomElementResolver.getInstance().resolve(
            selectorOrIndex,
            options.index
          );

          if (!target.success) {
            return {
              success: false,
              error: target.error ?? 'Failed to resolve element target',
              exitCode: target.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
            };
          }

          const response = await domClick({
            selector: target.selector,
            ...(target.index !== undefined && { index: target.index }),
            wait: options.wait !== false,
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to click element',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to click element',
              exitCode: result.error?.includes('not found')
                ? EXIT_CODES.RESOURCE_NOT_FOUND
                : EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: result.suggestion ?? 'Verify the selector matches a clickable element',
              },
            };
          }

          return { success: true, data: result };
        },
        options,
        formatClickOutput
      );
    });

  domCommand
    .command('submit')
    .description('Submit a form by clicking submit button and waiting for completion')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', parseInt)
    .option('--wait-navigation', 'Wait for page navigation after submit')
    .option('--wait-network <ms>', 'Wait for network idle after submit (milliseconds)', '1000')
    .option('--timeout <ms>', 'Maximum time to wait (milliseconds)', '10000')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: SubmitCommandOptions) => {
      await runCommand(
        async () => {
          const target = await DomElementResolver.getInstance().resolve(
            selectorOrIndex,
            options.index
          );

          if (!target.success) {
            return {
              success: false,
              error: target.error ?? 'Failed to resolve element target',
              exitCode: target.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
            };
          }

          const response = await domSubmit({
            selector: target.selector,
            ...(target.index !== undefined && { index: target.index }),
            ...(options.waitNavigation !== undefined && { waitNavigation: options.waitNavigation }),
            waitNetwork: parseInt(options.waitNetwork, 10),
            timeout: parseInt(options.timeout, 10),
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to submit form',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to submit form',
              exitCode: result.error?.includes('not found')
                ? EXIT_CODES.RESOURCE_NOT_FOUND
                : result.error?.includes('Timeout')
                  ? EXIT_CODES.CDP_TIMEOUT
                  : EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion:
                  result.suggestion ?? 'Verify the selector matches a form or submit button',
              },
            };
          }

          return { success: true, data: result };
        },
        options,
        formatSubmitOutput
      );
    });

  domCommand
    .command('pressKey')
    .description('Press a key on an element (for Enter-to-submit, keyboard navigation)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .argument('<key>', 'Key to press (Enter, Tab, Escape, Space, ArrowUp, etc.)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', parseInt)
    .option('--times <n>', 'Press key multiple times (default: 1)', parseInt)
    .option('--modifiers <mods>', 'Modifier keys: shift,ctrl,alt,meta (comma-separated)')
    .option('--no-wait', 'Skip waiting for network stability after key press')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, key: string, options: PressKeyCommandOptions) => {
      await runCommand(
        async () => {
          const target = await DomElementResolver.getInstance().resolve(
            selectorOrIndex,
            options.index
          );

          if (!target.success) {
            return {
              success: false,
              error: target.error ?? 'Failed to resolve element target',
              exitCode: target.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
            };
          }

          const response = await domPressKey({
            selector: target.selector,
            key,
            ...(target.index !== undefined && { index: target.index }),
            ...(options.times !== undefined && { times: options.times }),
            ...(options.modifiers !== undefined && { modifiers: options.modifiers }),
            wait: options.wait !== false,
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to press key',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to press key',
              exitCode: result.error?.includes('not found')
                ? EXIT_CODES.RESOURCE_NOT_FOUND
                : EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: result.suggestion ?? 'Verify the selector matches a focusable element',
              },
            };
          }

          return { success: true, data: result };
        },
        options,
        formatPressKeyOutput
      );
    });

  domCommand
    .command('scroll')
    .description('Scroll page to element, by pixels, or to page boundaries')
    .argument('[selector]', 'CSS selector to scroll into view (optional)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', parseInt)
    .option('--down <pixels>', 'Scroll down by pixels', parseInt)
    .option('--up <pixels>', 'Scroll up by pixels', parseInt)
    .option('--left <pixels>', 'Scroll left by pixels', parseInt)
    .option('--right <pixels>', 'Scroll right by pixels', parseInt)
    .option('--top', 'Scroll to page top')
    .option('--bottom', 'Scroll to page bottom')
    .option('--no-wait', 'Skip waiting for lazy-loaded content after scroll')
    .addOption(jsonOption())
    .action(async (selector: string | undefined, options: ScrollCommandOptions) => {
      await runCommand(
        async () => {
          if (options.index !== undefined && !selector) {
            return {
              success: false,
              error: '--index requires a selector',
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: { suggestion: 'Use: bdg dom scroll "selector" --index 2' },
            };
          }

          const hasConflictingVertical = options.down !== undefined && options.up !== undefined;
          const hasConflictingHorizontal =
            options.left !== undefined && options.right !== undefined;

          if (hasConflictingVertical || hasConflictingHorizontal) {
            return {
              success: false,
              error: 'Conflicting scroll directions specified',
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: hasConflictingVertical
                  ? 'Use either --down or --up, not both'
                  : 'Use either --left or --right, not both',
              },
            };
          }

          const hasOffsetOrPosition =
            options.down !== undefined ||
            options.up !== undefined ||
            options.left !== undefined ||
            options.right !== undefined ||
            options.top === true ||
            options.bottom === true;

          if (!selector && !hasOffsetOrPosition) {
            return {
              success: false,
              error: 'No scroll target specified',
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion:
                  'Provide a selector (bdg dom scroll "footer") or offset (--down 500, --bottom)',
              },
            };
          }

          const response = await domScroll({
            ...(selector !== undefined && { selector }),
            ...(options.index !== undefined && { index: options.index }),
            ...(options.down !== undefined && { down: options.down }),
            ...(options.up !== undefined && { up: options.up }),
            ...(options.left !== undefined && { left: options.left }),
            ...(options.right !== undefined && { right: options.right }),
            ...(options.top !== undefined && { top: options.top }),
            ...(options.bottom !== undefined && { bottom: options.bottom }),
            wait: options.wait !== false,
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to scroll',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to scroll',
              exitCode: result.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: result.suggestion ?? 'Verify the selector exists on the page',
              },
            };
          }

          return { success: true, data: result };
        },
        options,
        formatScrollOutput
      );
    });
}

/**
 * Format fill command output for human-readable display.
 */
function formatFillOutput(result: FillResult): string {
  const fmt = new OutputFormatter();
  fmt.text('✓ Element Filled');
  fmt.blank();

  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    ['Element Type', result.elementType ?? 'unknown'],
  ];

  if (result.inputType) details.push(['Input Type', result.inputType]);
  if (result.checked !== undefined) {
    details.push(['Checked', result.checked ? 'true' : 'false']);
  } else if (result.value) {
    details.push(['Value', result.value]);
  }

  fmt.keyValueList(details, 15);
  return fmt.build();
}

/**
 * Format click command output for human-readable display.
 */
function formatClickOutput(result: ClickResult): string {
  const fmt = new OutputFormatter();
  fmt.text('✓ Element Clicked');
  fmt.blank();
  fmt.keyValueList(
    [
      ['Selector', result.selector ?? 'unknown'],
      ['Element Type', result.elementType ?? 'unknown'],
      ['Clickable', result.clickable ? 'yes' : 'no (warning)'],
    ],
    15
  );
  if (!result.clickable) {
    fmt.blank();
    fmt.text('⚠ Warning: Element may not have a click handler');
  }
  return fmt.build();
}

/**
 * Format submit command output for human-readable display.
 */
function formatSubmitOutput(result: SubmitResult): string {
  const fmt = new OutputFormatter();
  fmt.text('✓ Form Submitted');
  fmt.blank();

  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    ['Clicked', result.clicked ? 'yes' : 'no'],
  ];

  if (result.networkRequests !== undefined)
    details.push(['Network Requests', result.networkRequests.toString()]);
  if (result.navigationOccurred !== undefined)
    details.push(['Navigation', result.navigationOccurred ? 'yes' : 'no']);
  if (result.waitTimeMs !== undefined) details.push(['Wait Time', `${result.waitTimeMs}ms`]);

  fmt.keyValueList(details, 20);
  fmt.blank();
  fmt.text('Next steps:');
  fmt.section('', [
    'bdg peek --network --last 10    Check network requests',
    'bdg console --last 5             Check console messages',
    'bdg status                       Check session state',
  ]);
  return fmt.build();
}

/**
 * Format pressKey command output for human-readable display.
 */
function formatPressKeyOutput(result: PressKeyResult): string {
  const fmt = new OutputFormatter();
  fmt.text('✓ Key Pressed');
  fmt.blank();

  const details: [string, string][] = [
    ['Key', result.key ?? 'unknown'],
    ['Selector', result.selector ?? 'unknown'],
    ['Element Type', result.elementType ?? 'unknown'],
  ];

  if (result.times && result.times > 1) details.push(['Times', result.times.toString()]);
  if (result.modifiers && result.modifiers > 0) {
    const mods: string[] = [];
    if (result.modifiers & 1) mods.push('Shift');
    if (result.modifiers & 2) mods.push('Ctrl');
    if (result.modifiers & 4) mods.push('Alt');
    if (result.modifiers & 8) mods.push('Meta');
    details.push(['Modifiers', mods.join('+')]);
  }

  fmt.keyValueList(details, 15);
  return fmt.build();
}

/**
 * Format scroll command output for human-readable display.
 */
function formatScrollOutput(result: ScrollResult): string {
  const fmt = new OutputFormatter();
  fmt.text('✓ Page Scrolled');
  fmt.blank();

  const details: [string, string][] = [['Scroll Type', result.scrollType]];
  if (result.selector) details.push(['Selector', result.selector]);
  if (result.scrolledTo)
    details.push(['Position', `(${result.scrolledTo.x}, ${result.scrolledTo.y})`]);
  if (result.scrolledBy && (result.scrolledBy.x !== 0 || result.scrolledBy.y !== 0))
    details.push(['Scrolled By', `(${result.scrolledBy.x}, ${result.scrolledBy.y})`]);
  if (result.viewportSize)
    details.push(['Viewport', `${result.viewportSize.width}x${result.viewportSize.height}`]);
  if (result.pageSize)
    details.push(['Page Size', `${result.pageSize.width}x${result.pageSize.height}`]);

  fmt.keyValueList(details, 15);
  return fmt.build();
}
