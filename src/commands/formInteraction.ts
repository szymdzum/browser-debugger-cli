/**
 * Form interaction commands for filling inputs, clicking buttons, and submitting forms.
 */

import type { Command } from 'commander';

import { fillElement, clickElement } from '@/helpers/formFillHelpers.js';
import { submitForm } from '@/helpers/formSubmitHelpers.js';
import type { SubmitResult } from '@/helpers/formSubmitHelpers.js';
import type { FillResult, ClickResult } from '@/helpers/reactEventHelpers.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

import { runCommand } from './shared/CommandRunner.js';
import { jsonOption } from './shared/commonOptions.js';

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
          // Create temporary CDP connection (same pattern as dom eval)
          const { CDPConnection } = await import('@/connection/cdp.js');
          const { validateActiveSession, getValidatedSessionMetadata, verifyTargetExists } =
            await import('./domEvalHelpers.js');

          // Validate session
          validateActiveSession();
          const metadata = getValidatedSessionMetadata();
          const port = 9222; // Default port
          await verifyTargetExists(metadata, port);

          // Connect to CDP
          const cdp = new CDPConnection();
          await cdp.connect(metadata.webSocketDebuggerUrl!);

          try {
            const fillOptions: { index?: number; blur?: boolean } = {
              blur: options.blur,
            };
            if (options.index !== undefined) {
              fillOptions.index = options.index;
            }

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
          } finally {
            cdp.close();
          }
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
          const { CDPConnection } = await import('@/connection/cdp.js');
          const { validateActiveSession, getValidatedSessionMetadata, verifyTargetExists } =
            await import('./domEvalHelpers.js');

          validateActiveSession();
          const metadata = getValidatedSessionMetadata();
          await verifyTargetExists(metadata, 9222);

          const cdp = new CDPConnection();
          await cdp.connect(metadata.webSocketDebuggerUrl!);

          try {
            const clickOptions: { index?: number } = {};
            if (options.index !== undefined) {
              clickOptions.index = options.index;
            }

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
          } finally {
            cdp.close();
          }
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
          const { CDPConnection } = await import('@/connection/cdp.js');
          const { validateActiveSession, getValidatedSessionMetadata, verifyTargetExists } =
            await import('./domEvalHelpers.js');

          validateActiveSession();
          const metadata = getValidatedSessionMetadata();
          await verifyTargetExists(metadata, 9222);

          const cdp = new CDPConnection();
          await cdp.connect(metadata.webSocketDebuggerUrl!);

          try {
            const submitOptions: {
              index?: number;
              waitNavigation?: boolean;
              waitNetwork?: number;
              timeout?: number;
            } = {
              waitNetwork: parseInt(options.waitNetwork),
              timeout: parseInt(options.timeout),
            };
            if (options.index !== undefined) {
              submitOptions.index = options.index;
            }
            if (options.waitNavigation !== undefined) {
              submitOptions.waitNavigation = options.waitNavigation;
            }

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
          } finally {
            cdp.close();
          }
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
