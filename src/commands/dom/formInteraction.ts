/**
 * Form interaction commands for filling inputs, clicking buttons, and submitting forms.
 */

import type { Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import {
  fillElement,
  clickElement,
  pressKeyElement,
  waitForActionStability,
  type PressKeyResult,
} from '@/commands/dom/formFillHelpers.js';
import { submitForm } from '@/commands/dom/formSubmitHelpers.js';
import type { SubmitResult } from '@/commands/dom/formSubmitHelpers.js';
import type { FillResult, ClickResult } from '@/commands/dom/reactEventHelpers.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  FillCommandOptions,
  ClickCommandOptions,
  SubmitCommandOptions,
  PressKeyCommandOptions,
} from '@/commands/shared/optionTypes.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { SessionMetadata } from '@/session/metadata.js';
import { CommandError } from '@/ui/errors/index.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { filterDefined } from '@/utils/objects.js';

/**
 * Execute a function with an active CDP connection.
 *
 * Handles the full connection lifecycle:
 * 1. Validates active session
 * 2. Gets session metadata
 * 3. Verifies target exists
 * 4. Creates and connects CDP
 * 5. Executes callback
 * 6. Closes CDP connection (even on error)
 *
 * @param fn - Callback to execute with CDP connection
 * @returns Result from callback
 * @throws Error if session validation or connection fails
 *
 * @internal
 */
async function withCDPConnection<T>(
  fn: (cdp: CDPConnection, metadata: SessionMetadata) => Promise<T>
): Promise<T> {
  const { CDPConnection } = await import('@/connection/cdp.js');
  const { validateActiveSession, getValidatedSessionMetadata, verifyTargetExists } = await import(
    '@/commands/dom/evalHelpers.js'
  );

  validateActiveSession();
  const metadata = getValidatedSessionMetadata();
  const port = 9222; // Default port
  await verifyTargetExists(metadata, port);

  const cdp = new CDPConnection();
  if (!metadata.webSocketDebuggerUrl) {
    throw new CommandError(
      'Missing webSocketDebuggerUrl in session metadata',
      { suggestion: 'Session metadata may be corrupted or from an older version' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  await cdp.connect(metadata.webSocketDebuggerUrl);

  try {
    return await fn(cdp, metadata);
  } finally {
    cdp.close();
  }
}

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
    throw new CommandError(
      'DOM command group not found',
      { suggestion: 'This is an internal error - DOM commands may not be registered' },
      EXIT_CODES.SOFTWARE_ERROR
    );
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
              suggestion: target.suggestion,
            };
          }

          return await withCDPConnection(async (cdp) => {
            const fillOptions = filterDefined({
              index: target.index,
              blur: options.blur,
            }) as { index?: number; blur?: boolean };

            const result = await fillElement(cdp, target.selector, value, fillOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to fill element',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            if (options.wait !== false) {
              await waitForActionStability(cdp);
            }

            return { success: true, data: result };
          });
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
              suggestion: target.suggestion,
            };
          }

          return await withCDPConnection(async (cdp) => {
            const clickOptions = filterDefined({
              index: target.index,
            }) as { index?: number };

            const result = await clickElement(cdp, target.selector, clickOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to click element',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            if (options.wait !== false) {
              await waitForActionStability(cdp);
            }

            return { success: true, data: result };
          });
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
              suggestion: target.suggestion,
            };
          }

          return await withCDPConnection(async (cdp) => {
            const submitOptions = filterDefined({
              index: target.index,
              waitNavigation: options.waitNavigation,
              waitNetwork: parseInt(options.waitNetwork, 10),
              timeout: parseInt(options.timeout, 10),
            }) as {
              index?: number;
              waitNavigation?: boolean;
              waitNetwork?: number;
              timeout?: number;
            };

            const result = await submitForm(cdp, target.selector, submitOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to submit form',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : result.error?.includes('Timeout')
                    ? EXIT_CODES.CDP_TIMEOUT
                    : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            return { success: true, data: result };
          });
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
              suggestion: target.suggestion,
            };
          }

          return await withCDPConnection(async (cdp) => {
            const pressKeyOptions = filterDefined({
              index: target.index,
              times: options.times,
              modifiers: options.modifiers,
            }) as { index?: number; times?: number; modifiers?: string };

            const result = await pressKeyElement(cdp, target.selector, key, pressKeyOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to press key',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            if (options.wait !== false) {
              await waitForActionStability(cdp);
            }

            return { success: true, data: result };
          });
        },
        options,
        formatPressKeyOutput
      );
    });
}

/**
 * Format fill command output for human-readable display.
 *
 * @param result - Fill result
 * @returns Formatted string
 */
function formatFillOutput(result: FillResult): string {
  const fmt = new OutputFormatter();

  fmt.text('✓ Element Filled');
  fmt.blank();

  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    ['Element Type', result.elementType ?? 'unknown'],
  ];

  if (result.inputType) {
    details.push(['Input Type', result.inputType]);
  }

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
 *
 * @param result - Click result
 * @returns Formatted string
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
 *
 * @param result - Submit result
 * @returns Formatted string
 */
function formatSubmitOutput(result: SubmitResult): string {
  const fmt = new OutputFormatter();

  fmt.text('✓ Form Submitted');
  fmt.blank();

  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    ['Clicked', result.clicked ? 'yes' : 'no'],
  ];

  if (result.networkRequests !== undefined) {
    details.push(['Network Requests', result.networkRequests.toString()]);
  }

  if (result.navigationOccurred !== undefined) {
    details.push(['Navigation', result.navigationOccurred ? 'yes' : 'no']);
  }

  if (result.waitTimeMs !== undefined) {
    details.push(['Wait Time', `${result.waitTimeMs}ms`]);
  }

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
 *
 * @param result - Press key result
 * @returns Formatted string
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

  if (result.times && result.times > 1) {
    details.push(['Times', result.times.toString()]);
  }

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
