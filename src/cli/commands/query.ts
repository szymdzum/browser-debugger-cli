import type { Command } from 'commander';

import { OutputBuilder } from '@/cli/handlers/OutputBuilder.js';
import { DEFAULT_DEBUG_PORT, PORT_OPTION_DESCRIPTION } from '@/constants';
import { readPid, isProcessAlive } from '@/utils/session.js';

/**
 * Flags accepted by the `bdg query` command.
 * @property port Chrome debugging port to target for evaluation.
 * @property json Output result wrapped in version/success format.
 */
interface QueryOptions {
  port: string;
  json?: boolean;
}

interface CDPTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

/**
 * Register query command
 *
 * @param program - Commander.js Command instance to register commands on
 * @returns void
 */
export function registerQueryCommand(program: Command): void {
  program
    .command('query')
    .description('Execute JavaScript in the active session for live debugging')
    .argument(
      '<script>',
      'JavaScript to execute (e.g., "document.querySelector(\'input[type=email]\').value")'
    )
    .option('-p, --port <number>', PORT_OPTION_DESCRIPTION, DEFAULT_DEBUG_PORT)
    .option('-j, --json', 'Wrap result in version/success format')
    .action(async (script: string, options: QueryOptions) => {
      try {
        const port = parseInt(options.port, 10);

        // Check if session is running
        const pid = readPid();
        if (!pid || !isProcessAlive(pid)) {
          const errorMsg = 'No active session running';
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(errorMsg, {
                  suggestion: 'Start a session with: bdg <url>',
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Error: ${errorMsg}`);
            console.error('Start a session with: bdg <url>');
          }
          process.exit(1);
        }

        // Read session metadata to get the target ID
        const { readSessionMetadata } = await import('../../utils/session.js');
        const metadata = readSessionMetadata();

        if (!metadata?.targetId || !metadata.webSocketDebuggerUrl) {
          const errorMsg = 'No target information in session metadata';
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(errorMsg, {
                  note: 'Session may have been started with an older version',
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Error: ${errorMsg}`);
            console.error('Session may have been started with an older version');
          }
          process.exit(1);
        }

        // Verify the target still exists
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targetsData: unknown = await response.json();
        if (!Array.isArray(targetsData)) {
          const errorMsg = 'Invalid response from CDP';
          if (options.json) {
            console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
          } else {
            console.error(`Error: ${errorMsg}`);
          }
          process.exit(1);
        }
        const target = (targetsData as CDPTarget[]).find((t) => t.id === metadata.targetId);

        if (!target) {
          const errorMsg = 'Session target not found (tab may have been closed)';
          if (options.json) {
            console.log(
              JSON.stringify(
                OutputBuilder.buildJsonError(errorMsg, {
                  suggestion: 'Start a new session with: bdg <url>',
                }),
                null,
                2
              )
            );
          } else {
            console.error(`Error: ${errorMsg}`);
            console.error('Start a new session with: bdg <url>');
          }
          process.exit(1);
        }

        // Create temporary CDP connection using stored webSocketDebuggerUrl
        const { CDPConnection } = await import('../../connection/cdp.js');
        const cdp = new CDPConnection();
        await cdp.connect(metadata.webSocketDebuggerUrl);

        // Execute JavaScript
        const result = (await cdp.send('Runtime.evaluate', {
          expression: script,
          returnByValue: true,
          awaitPromise: true,
        })) as {
          exceptionDetails?: { exception?: { description?: string } };
          result?: { value?: unknown };
        };

        cdp.close();

        // Output result
        if (result.exceptionDetails) {
          const errorMsg =
            result.exceptionDetails.exception?.description ?? 'Unknown error executing script';
          if (options.json) {
            console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
          } else {
            console.error('Error executing script:');
            console.error(errorMsg);
          }
          process.exit(1);
        }

        // Output result (wrapped if --json, raw otherwise)
        if (options.json) {
          console.log(
            JSON.stringify(
              OutputBuilder.buildJsonSuccess({
                result: result.result?.value,
              }),
              null,
              2
            )
          );
        } else {
          console.log(JSON.stringify(result.result?.value, null, 2));
        }
        process.exit(0);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (options.json) {
          console.log(JSON.stringify(OutputBuilder.buildJsonError(errorMsg), null, 2));
        } else {
          console.error(`Error: ${errorMsg}`);
        }
        process.exit(1);
      }
    });
}
