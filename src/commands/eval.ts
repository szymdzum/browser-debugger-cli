import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { BaseOptions, PortOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/ui/errors/index.js';
import { formatEval } from '@/ui/formatters/eval.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for the eval command
 */
export type EvalCommandOptions = BaseOptions & PortOptions;

/**
 * Handle bdg eval command.
 *
 * @param script - JavaScript expression to evaluate
 * @param options - Command options
 */
async function handleEval(script: string, options: EvalCommandOptions): Promise<void> {
  await runCommand(
    async () => {
      const { CDPConnection } = await import('@/connection/cdp.js');
      const {
        validateActiveSession,
        getValidatedSessionMetadata,
        verifyTargetExists,
        executeScript,
      } = await import('@/commands/dom/evalHelpers.js');

      validateActiveSession();

      const metadata = getValidatedSessionMetadata();

      // Use port from session metadata, not CLI option
      const port = metadata.port;
      if (!port) {
        throw new CommandError(
          'Session metadata missing port',
          { suggestion: 'Restart the session with: bdg stop && bdg <url>' },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      await verifyTargetExists(metadata, port);

      const cdp = new CDPConnection();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await cdp.connect(metadata.webSocketDebuggerUrl!);

      const result = await executeScript(cdp, script);
      cdp.close();

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { result: result.result?.value },
      };
    },
    options,
    formatEval
  );
}

/**
 * Register the eval command.
 *
 * @param program - Commander.js Command instance
 */
export function registerEvalCommand(program: Command): void {
  program
    .command('eval')
    .description('Evaluate JavaScript expression in the page context')
    .argument('<script>', 'JavaScript to execute (e.g., "document.title", "window.location.href")')
    .option('-p, --port <number>', 'Chrome debugging port (default: 9222)')
    .option('-j, --json', 'Wrap result in version/success format')
    .action(async (script: string, options: EvalCommandOptions) => {
      await handleEval(script, options);
    });
}
