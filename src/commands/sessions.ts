import type { Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { includeSensitiveOption, jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions, SensitiveUrlOptions } from '@/commands/shared/optionTypes.js';
import { listRunningSessions, type RunningSessionInfo } from '@/session/sessionList.js';
import { formatSessionList } from '@/ui/formatters/sessions.js';
import { includeSensitiveWarning } from '@/ui/messages/networkMessages.js';

/** Options of `bdg sessions` */
type SessionsCommandOptions = BaseOptions & SensitiveUrlOptions;

/**
 * Register the sessions command (lists running default and named sessions).
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerSessionsCommand(program: Command): void {
  program
    .command('sessions')
    .description(
      'List sessions (default and named) with their state, URL, port and PID, including crashed ones to clean up'
    )
    .addOption(jsonOption())
    .addOption(includeSensitiveOption())
    .action(async (options: SessionsCommandOptions) => {
      await runCommand<SessionsCommandOptions, { sessions: RunningSessionInfo[] }>(
        async () => ({
          success: true,
          data: { sessions: await listRunningSessions(options.includeSensitive) },
          ...(options.includeSensitive && { warning: includeSensitiveWarning() }),
        }),
        options,
        formatSessionList
      );
    });
}
