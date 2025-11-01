import type { Command } from 'commander';

import { DEFAULT_DEBUG_PORT, PORT_OPTION_DESCRIPTION } from '@/constants';
import { readPid, isProcessAlive } from '@/utils/session.js';

/**
 * Flags accepted by the `bdg query` command.
 * @property port Chrome debugging port to target for evaluation.
 */
interface QueryOptions {
  port: string;
}

interface CDPTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

/**
 * Register query command
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
    .action(async (script: string, options: QueryOptions) => {
      try {
        const port = parseInt(options.port, 10);

        // Check if session is running
        const pid = readPid();
        if (!pid || !isProcessAlive(pid)) {
          console.error('Error: No active session running');
          console.error('Start a session with: bdg <url>');
          process.exit(1);
        }

        // Read session metadata to get the target ID
        const { readSessionMetadata } = await import('../../utils/session.js');
        const metadata = readSessionMetadata();

        if (!metadata?.targetId || !metadata.webSocketDebuggerUrl) {
          console.error('Error: No target information in session metadata');
          console.error('Session may have been started with an older version');
          process.exit(1);
        }

        // Verify the target still exists
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targetsData: unknown = await response.json();
        if (!Array.isArray(targetsData)) {
          console.error('Error: Invalid response from CDP');
          process.exit(1);
        }
        const target = (targetsData as CDPTarget[]).find((t) => t.id === metadata.targetId);

        if (!target) {
          console.error('Error: Session target not found (tab may have been closed)');
          console.error('Start a new session with: bdg <url>');
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
          console.error('Error executing script:');
          console.error(result.exceptionDetails.exception?.description ?? 'Unknown error');
          process.exit(1);
        }

        console.log(JSON.stringify(result.result?.value, null, 2));
        process.exit(0);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
