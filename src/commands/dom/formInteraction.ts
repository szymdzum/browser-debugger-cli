/**
 * Form interaction commands for filling inputs, clicking buttons, and submitting forms.
 */

import type { Command } from 'commander';

import { fillElement, clickElement } from '@/commands/dom/formFillHelpers.js';
import { submitForm } from '@/commands/dom/formSubmitHelpers.js';
import type { SubmitResult } from '@/commands/dom/formSubmitHelpers.js';
import type { FillResult, ClickResult } from '@/commands/dom/reactEventHelpers.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CDPConnection } from '@/connection/cdp.js';
import type { SessionMetadata } from '@/session/metadata.js';
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

  // Validate session
  validateActiveSession();
  const metadata = getValidatedSessionMetadata();
  const port = 9222; // Default port
  await verifyTargetExists(metadata, port);

  // Connect to CDP
  const cdp = new CDPConnection();
  if (!metadata.webSocketDebuggerUrl) {
    throw new Error('Missing webSocketDebuggerUrl in session metadata');
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
    throw new Error('DOM command group not found');
  }

  // bdg dom fill <selector> <value>
  domCommand
    .command('fill')
    .description('Fill a form field with a value (React-compatible)')
    .argument('<selector>', 'CSS selector for the element')
    .argument('<value>', 'Value to fill')
    .option('--index <n>', 'Element index if selector matches multiple (1-based)', parseInt)
    .option('--no-blur', 'Do not blur after filling (keeps focus on element)')
    .addOption(jsonOption)
    .action(async (selector: string, value: string, options: FillCommandOptions) => {
      await runCommand(
        async () => {
          return await withCDPConnection(async (cdp) => {
            const fillOptions = filterDefined({
              index: options.index,
              blur: options.blur,
            }) as { index?: number; blur?: boolean };

            const result = await fillElement(cdp, selector, value, fillOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to fill element',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            return { success: true, data: result };
          });
        },
        options,
        formatFillOutput
      );
    });

  // bdg dom click <selector>
  domCommand
    .command('click')
    .description('Click an element')
    .argument('<selector>', 'CSS selector for the element')
    .option('--index <n>', 'Element index if selector matches multiple (1-based)', parseInt)
    .addOption(jsonOption)
    .action(async (selector: string, options: ClickCommandOptions) => {
      await runCommand(
        async () => {
          return await withCDPConnection(async (cdp) => {
            const clickOptions = filterDefined({
              index: options.index,
            }) as { index?: number };

            const result = await clickElement(cdp, selector, clickOptions);

            if (!result.success) {
              return {
                success: false,
                error: result.error ?? 'Failed to click element',
                exitCode: result.error?.includes('not found')
                  ? EXIT_CODES.RESOURCE_NOT_FOUND
                  : EXIT_CODES.INVALID_ARGUMENTS,
              };
            }

            return { success: true, data: result };
          });
        },
        options,
        formatClickOutput
      );
    });

  // bdg dom submit <selector>
  domCommand
    .command('submit')
    .description('Submit a form by clicking submit button and waiting for completion')
    .argument('<selector>', 'CSS selector for the submit button')
    .option('--index <n>', 'Element index if selector matches multiple (1-based)', parseInt)
    .option('--wait-navigation', 'Wait for page navigation after submit')
    .option('--wait-network <ms>', 'Wait for network idle after submit (milliseconds)', '1000')
    .option('--timeout <ms>', 'Maximum time to wait (milliseconds)', '10000')
    .addOption(jsonOption)
    .action(async (selector: string, options: SubmitCommandOptions) => {
      await runCommand(
        async () => {
          return await withCDPConnection(async (cdp) => {
            const submitOptions = filterDefined({
              index: options.index,
              waitNavigation: options.waitNavigation,
              waitNetwork: parseInt(options.waitNetwork, 10),
              timeout: parseInt(options.timeout, 10),
            }) as {
              index?: number;
              waitNavigation?: boolean;
              waitNetwork?: number;
              timeout?: number;
            };

            const result = await submitForm(cdp, selector, submitOptions);

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
}

/**
 * Options for fill command.
 */
interface FillCommandOptions {
  index?: number;
  blur: boolean;
  json?: boolean;
}

/**
 * Options for click command.
 */
interface ClickCommandOptions {
  index?: number;
  json?: boolean;
}

/**
 * Options for submit command.
 */
interface SubmitCommandOptions {
  index?: number;
  waitNavigation?: boolean;
  waitNetwork: string;
  timeout: string;
  json?: boolean;
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
