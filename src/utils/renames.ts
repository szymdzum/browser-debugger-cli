/**
 * The rename table: every old spelling of a command or option (#465) and
 * what replaces it. One row per old spelling drives everything about it:
 * the old spelling stays parsed (a hidden command or option), is hidden from
 * help and typo suggestions, warns while `deprecated` (stderr in human mode,
 * `warnings` in the `--json` envelope) and exits 81 once `removed`.
 */

/**
 * `deprecated`: the old spelling still works, with a warning (0.x).
 * `removed`: the old spelling exits 81 and names its replacement (1.0).
 */
export type RenameStage = 'deprecated' | 'removed';

/** Fields every rename entry has */
interface RenameEntryBase {
  /** Words of the command the old name belongs to, without `bdg` (`''` for the root, `'cleanup'`, `'dom'`) */
  command: string;
  /** Stage of the old spelling */
  stage: RenameStage;
}

/**
 * An old command name. Its replacement may live under another parent
 * (`dom eval` → `eval`), so `new` is the full command path from the root.
 * While deprecated, its module still registers it (hidden) and it runs as
 * before; once removed, the table registers a hidden stub that exits 81.
 */
interface CommandRename extends RenameEntryBase {
  kind: 'command';
  /** Old subcommand name of `command` (`tail`, `pressKey`) */
  old: string;
  /** New command words from the root, without `bdg` (`peek --follow`, `dom press-key`) */
  new?: string;
}

/**
 * An old long option. Its replacement is an option of the same command,
 * which gets the old option's value while it is deprecated.
 */
interface OptionRename extends RenameEntryBase {
  kind: 'option';
  /** Old long option (`--aggressive`), or a short-only one (`-f`) */
  old: string;
  /** Old short form of a long `old` (`-t` for `--timeout`), recognized the same way */
  short?: string;
  /** New long option of the same command (`--force`) */
  new?: string;
  /** Value the new option gets in place of the old option's own (`all` for `--history` → `--page all`) */
  value?: string;
  /** Whether the option takes a value (`--old <value>`, `--old=value`) */
  takesValue?: boolean;
  /** Value placeholder the new spelling shows (`<seconds>`: `--stop-after <seconds>`) */
  newValueName?: string;
}

/** What replaces an old spelling: a new name, or (a pure removal) what to do instead */
type Replacement = { new: string; hint?: undefined } | { new?: undefined; hint: string };

/** One old spelling */
export type RenameEntry = (CommandRename | OptionRename) & Replacement;

/**
 * Every old spelling bdg still recognizes. Since 1.0 all of them are
 * removed; a later rename goes through a `deprecated` row in a minor first.
 */
export const RENAMES: readonly RenameEntry[] = [
  { kind: 'command', command: '', old: 'tail', new: 'peek --follow', stage: 'removed' },
  {
    kind: 'command',
    command: '',
    old: 'details',
    stage: 'removed',
    hint: 'use "bdg network details <id>" or "bdg console details <n>"',
  },
  {
    kind: 'command',
    command: 'network',
    old: 'document',
    new: 'network headers',
    stage: 'removed',
  },
  { kind: 'command', command: 'dom', old: 'eval', new: 'eval', stage: 'removed' },
  { kind: 'command', command: 'dom', old: 'pressKey', new: 'dom press-key', stage: 'removed' },
  {
    kind: 'command',
    command: 'network',
    old: 'getCookies',
    new: 'network cookies',
    stage: 'removed',
  },
  {
    kind: 'option',
    command: 'cleanup',
    old: '--aggressive',
    new: '--force',
    stage: 'removed',
  },
  { kind: 'option', command: 'cleanup', old: '-f', new: '--force', stage: 'removed' },
  {
    kind: 'option',
    command: '',
    old: '--timeout',
    short: '-t',
    new: '--stop-after',
    stage: 'removed',
    takesValue: true,
    newValueName: '<seconds>',
  },
  {
    kind: 'option',
    command: 'attach',
    old: '--timeout',
    new: '--stop-after',
    stage: 'removed',
    takesValue: true,
    newValueName: '<seconds>',
  },
  {
    kind: 'option',
    command: 'dom audit',
    old: '--level',
    new: '--wcag',
    stage: 'removed',
    takesValue: true,
    newValueName: '<level>',
  },
  {
    kind: 'option',
    command: 'dom get',
    old: '--nth',
    new: '--index',
    stage: 'removed',
    takesValue: true,
    newValueName: '<n>',
  },
  {
    kind: 'option',
    command: '',
    old: '--all',
    short: '-a',
    new: '--capture-all',
    stage: 'removed',
  },
  {
    kind: 'option',
    command: 'console',
    old: '--history',
    short: '-H',
    new: '--page',
    value: 'all',
    stage: 'removed',
  },
  {
    kind: 'option',
    command: 'stop',
    old: '--kill-chrome',
    stage: 'removed',
    hint: 'bdg stop already closes the Chrome bdg launched; drop the flag',
  },
  {
    kind: 'option',
    command: '',
    old: '--compact',
    stage: 'removed',
    hint: 'It had no effect; drop the flag',
  },
  {
    kind: 'option',
    command: 'cleanup',
    old: '--remove-output',
    stage: 'removed',
    hint: 'bdg no longer writes session.json; drop the flag',
  },
];

/**
 * An entry's old or new name as a user types it: `bdg tail`,
 * `bdg peek --follow`, `bdg cleanup --aggressive`, `bdg <url> --compact` (a
 * root option goes with the start URL). A new command name is a full path.
 *
 * @param entry - Rename entry
 * @param which - The old name, or the new one (empty for a pure removal)
 * @returns `bdg …` spelling
 */
export function spelling(entry: RenameEntry, which: 'old' | 'new'): string {
  const name = entry[which] ?? '';
  if (entry.kind === 'command' && which === 'new') return `bdg ${name}`;
  const command = entry.kind === 'option' && entry.command === '' ? '<url>' : entry.command;
  const value =
    entry.kind === 'option' && which === 'new' ? (entry.value ?? entry.newValueName) : '';
  return ['bdg', command, name, value].filter(Boolean).join(' ');
}

/**
 * Whether a subcommand or long option of a command is an old spelling, so
 * help and typo suggestions leave it out.
 *
 * @param command - Command words without `bdg` (`''` for the root)
 * @param name - Subcommand name or long option
 * @param table - Rename table
 * @returns True for an old spelling
 */
export function isRetiredName(
  command: string,
  name: string,
  table: readonly RenameEntry[] = RENAMES
): boolean {
  return table.some((entry) => entry.command === command && entry.old === name);
}
