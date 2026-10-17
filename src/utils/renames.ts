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
  /** Old command name (`tail`) or long option (`--aggressive`) */
  old: string;
  /** Stage of the old spelling */
  stage: RenameStage;
  /** Option entries: whether the option takes a value (`--old <value>`, `--old=value`) */
  takesValue?: boolean;
}

/**
 * One old spelling. A rename names the new spelling (a command path below
 * `command`, e.g. `peek --follow` for the root, or a long option of the same
 * command); a pure removal has no new name and says what to do instead.
 */
export type RenameEntry = RenameEntryBase &
  (
    | {
        /** New command words below `command` (`peek --follow`) or new long option (`--force`) */
        new: string;
        hint?: undefined;
      }
    | {
        new?: undefined;
        /** What to do instead, shown after the old spelling (`bdg stop already closes …`) */
        hint: string;
      }
  );

/** Every old spelling bdg still recognizes */
export const RENAMES: readonly RenameEntry[] = [
  { command: '', old: 'tail', new: 'peek --follow', stage: 'deprecated' },
  { command: 'cleanup', old: '--aggressive', new: '--force', stage: 'deprecated' },
  {
    command: 'stop',
    old: '--kill-chrome',
    stage: 'deprecated',
    hint: 'bdg stop already closes the Chrome bdg launched; drop the flag',
  },
  {
    command: '',
    old: '--compact',
    stage: 'removed',
    hint: 'It had no effect; drop the flag',
  },
  {
    command: 'cleanup',
    old: '--remove-output',
    stage: 'removed',
    hint: 'bdg no longer writes session.json; drop the flag',
  },
];

/**
 * Whether an entry renames or removes an option (else a command).
 *
 * @param entry - Rename entry
 * @returns True for an option entry
 */
export function isOptionEntry(entry: RenameEntry): boolean {
  void entry;
  throw new Error('not implemented');
}

/**
 * The old spelling as a user types it: `bdg tail`, `bdg cleanup --aggressive`,
 * `bdg <url> --compact` (a root option goes with the start URL).
 *
 * @param entry - Rename entry
 * @returns Old spelling
 */
export function oldSpelling(entry: RenameEntry): string {
  void entry;
  throw new Error('not implemented');
}

/**
 * Whether a command or option name of a command is an old spelling, so help
 * and typo suggestions leave it out.
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
  void command;
  void name;
  void table;
  throw new Error('not implemented');
}
