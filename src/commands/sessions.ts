import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { listRunningSessions, type RunningSessionInfo } from '@/session/sessionList.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';

/**
 * Register the sessions command (lists running default and named sessions).
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerSessionsCommand(program: Command): void {
  program
    .command('sessions')
    .description('List running sessions (default and named) with their URL, port and PID')
    .addOption(jsonOption())
    .action(async (options: BaseOptions) => {
      await runCommand<BaseOptions, { sessions: RunningSessionInfo[] }>(
        async () => ({ success: true, data: { sessions: await listRunningSessions() } }),
        options,
        formatSessionList
      );
    });
}
