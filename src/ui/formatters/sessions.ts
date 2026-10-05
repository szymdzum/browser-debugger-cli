import type { RunningSessionInfo } from '@/session/sessionList.js';
import { OutputFormatter } from '@/ui/formatting.js';

/** Label of the default session in the list */
const DEFAULT_SESSION_LABEL = '(default)';

/**
 * Format the running sessions as a table.
 *
 * @param data - Running sessions
 * @returns Human-readable list
 */
export function formatSessionList(data: { sessions: RunningSessionInfo[] }): string {
  const fmt = new OutputFormatter();
  if (data.sessions.length === 0) {
    return fmt
      .text('No running sessions')
      .hints('Suggestions:', ['Start one:  bdg <url> [--session <name>]'])
      .build();
  }
  const rows = data.sessions.map((session) => [
    session.name ?? DEFAULT_SESSION_LABEL,
    session.state,
    session.port?.toString() ?? '-',
    session.daemonPid?.toString() ?? '-',
    session.url ?? '-',
  ]);
  const header = ['SESSION', 'STATE', 'PORT', 'PID', 'URL'];
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  for (const row of [header, ...rows]) {
    fmt.text(
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join('  ')
        .trimEnd()
    );
  }
  return fmt.build();
}
