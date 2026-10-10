/**
 * Behavioral metadata registry for self-documenting CLI options.
 *
 * Maps option flags to rich behavioral context that helps agents
 * understand option effects without trial-and-error or source inspection.
 * The entries live in `optionBehaviors/<area>.ts`, one table per command
 * area, so changes to different commands touch different files; add a key to
 * the table of its command, and a new table to {@link BEHAVIOR_TABLES}.
 *
 * @see docs/principles/SELF_DOCUMENTING_SYSTEMS.md
 */

import type { Option } from 'commander';

import type { OptionBehavior } from '@/commands/helpJson.js';
import { CDP_BEHAVIORS } from '@/commands/optionBehaviors/cdp.js';
import { CONSOLE_BEHAVIORS } from '@/commands/optionBehaviors/console.js';
import { DOM_ACTION_BEHAVIORS } from '@/commands/optionBehaviors/domActions.js';
import { DOM_READ_BEHAVIORS } from '@/commands/optionBehaviors/domRead.js';
import { NETWORK_BEHAVIORS } from '@/commands/optionBehaviors/network.js';
import { PEEK_BEHAVIORS } from '@/commands/optionBehaviors/peek.js';
import { SCREENSHOT_BEHAVIORS } from '@/commands/optionBehaviors/screenshot.js';
import { SESSION_BEHAVIORS } from '@/commands/optionBehaviors/session.js';
import type { BehaviorKey, BehaviorTable } from '@/commands/optionBehaviors/shared.js';
import { STATE_BEHAVIORS } from '@/commands/optionBehaviors/state.js';

/** Every area's table; a key must appear in one table only (checked by a unit test) */
export const BEHAVIOR_TABLES: readonly BehaviorTable[] = [
  SCREENSHOT_BEHAVIORS,
  DOM_READ_BEHAVIORS,
  DOM_ACTION_BEHAVIORS,
  CONSOLE_BEHAVIORS,
  PEEK_BEHAVIORS,
  NETWORK_BEHAVIORS,
  SESSION_BEHAVIORS,
  STATE_BEHAVIORS,
  CDP_BEHAVIORS,
];

/**
 * Behavioral metadata registry.
 *
 * Keyed by "command:flag" to support same flag names across different commands.
 */
const OPTION_BEHAVIORS: BehaviorTable = Object.assign({}, ...BEHAVIOR_TABLES) as BehaviorTable;

/**
 * Build behavior registry key from command and option: the command's own
 * name (`bdg` for the root) and the option's long flag, or its short flag
 * when it has no long one.
 *
 * @param commandName - Command name (e.g., "screenshot")
 * @param option - Commander option
 * @returns Registry key
 */
export function behaviorKey(commandName: string, option: Option): BehaviorKey {
  return `${commandName}:${option.long ?? option.short ?? option.flags}`;
}

/**
 * Every key in the behavior registry.
 *
 * @returns Registry keys
 */
export function listBehaviorKeys(): BehaviorKey[] {
  return Object.keys(OPTION_BEHAVIORS);
}

/**
 * Look up behavioral metadata for an option.
 *
 * @param commandName - Name of the command containing the option
 * @param option - Commander option
 * @returns Behavioral metadata if registered, undefined otherwise
 */
export function getOptionBehavior(commandName: string, option: Option): OptionBehavior | undefined {
  return OPTION_BEHAVIORS[behaviorKey(commandName, option)];
}
