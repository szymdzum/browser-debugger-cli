/**
 * Form interaction commands for filling inputs, clicking buttons, and submitting forms.
 *
 * These commands delegate the CDP work to the daemon via IPC. The CLI
 * never opens its own CDP connection — the daemon owns the single persistent
 * CDP session and runs the full fill/click/submit sequence (including event
 * subscriptions for network-stability waits) on behalf of the CLI.
 */

import { InvalidArgumentError, type Command } from 'commander';

import { DomElementResolver } from '@/commands/dom/DomElementResolver.js';
import { runElementCommand } from '@/commands/dom/helpers/runElementCommand.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type {
  FillCommandOptions,
  ClickCommandOptions,
  SubmitCommandOptions,
  PressKeyCommandOptions,
  ScrollCommandOptions,
} from '@/commands/shared/optionTypes.js';
import { integerOption } from '@/commands/shared/validation.js';
import { CommandError } from '@/errors/index.js';
import {
  VIA_LABEL_SUFFIX,
  conflictingOptionsMessage,
  internalError,
  scrollOptionsError,
} from '@/errors/messages.js';
import { domClick, domFill, domPressKey, domScroll, domSubmit } from '@/ipc/client.js';
import type { ActionEffects, DialogInfo, TriggeredRequest } from '@/ipc/protocol/domTypes.js';
import { type PressKeyResult, type ScrollResult } from '@/runtime/dom/formFillHelpers/index.js';
import type { SubmitResult } from '@/runtime/dom/formSubmitHelpers.js';
import { findUnknownModifiers } from '@/runtime/dom/keyMapping.js';
import type { FillResult, ClickResult } from '@/runtime/dom/reactEventHelpers.js';
import {
  formatTriggeredRequestLines,
  formatTriggeredRequestsTitle,
} from '@/ui/formatters/triggeredRequests.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  CLICK_RESULT_WAIT_HELP,
  POINTER_ACTION_DONE,
  actionStatusLine,
  dialogConsoleText,
  newMessageText,
  pageNavigationText,
} from '@/ui/messages/commands.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Commander parser for `--modifiers`: rejects unknown names instead of
 * silently pressing the bare key.
 *
 * @param value - Comma-separated modifier names
 * @returns The value, unchanged
 */
function modifiersOption(value: string): string {
  const [unknown] = findUnknownModifiers(value);
  if (unknown !== undefined) {
    throw new InvalidArgumentError(`Unknown modifier "${unknown}" (use shift, ctrl, alt, meta)`);
  }
  return value;
}

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
    const err = internalError('DOM command group not found');
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }

  domCommand
    .command('fill')
    .description('Fill a form field with a value (React-compatible, waits for stability)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .argument('<value>', 'Value to fill (file inputs: paths separated by commas, "" clears)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--no-blur', 'Do not blur after filling (keeps focus on element)')
    .option('--no-wait', 'Skip waiting for network stability after fill')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, value: string, options: FillCommandOptions) => {
      await runCommand(
        () =>
          runElementCommand<Parameters<typeof domFill>[0], FillResult>({
            selectorOrIndex,
            index: options.index,
            buildRequest: (target) => ({
              ...target,
              value,
              cwd: process.cwd(),
              ...(options.blur !== undefined && { blur: options.blur }),
              wait: options.wait !== false,
            }),
            call: domFill,
            command: 'fill',
            action: 'fill element',
            failureSuggestion:
              'Verify the selector matches a fillable element (input, textarea, select)',
          }),
        options,
        formatFillOutput
      );
    });

  domCommand
    .command('click')
    .description('Click an element and wait for stability (accepts selector or index)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--double', 'Double-click')
    .option('--right', 'Right-click (opens the context menu)')
    .option('--no-wait', 'Skip waiting for network stability after click')
    .addOption(jsonOption())
    .addHelpText('after', CLICK_RESULT_WAIT_HELP)
    .action(async (selectorOrIndex: string, options: ClickCommandOptions) => {
      const action = options.double ? 'double' : options.right ? 'right' : 'click';
      await runPointerCommand(selectorOrIndex, options, action);
    });

  domCommand
    .command('hover')
    .description('Move the mouse over an element (shows hover menus and tooltips)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--no-wait', 'Skip waiting for network stability after hovering')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, options: ClickCommandOptions) => {
      await runPointerCommand(selectorOrIndex, options, 'hover');
    });

  domCommand
    .command('submit')
    .description('Submit a form by clicking submit button and waiting for completion')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--wait-navigation', 'Wait for page navigation after submit')
    .option(
      '--wait-network <ms>',
      'Wait for network idle after submit (milliseconds)',
      integerOption(0),
      1000
    )
    .option('--timeout <ms>', 'Maximum time to wait (milliseconds)', integerOption(1), 10000)
    .addOption(jsonOption())
    .addHelpText('after', CLICK_RESULT_WAIT_HELP)
    .action(async (selectorOrIndex: string, options: SubmitCommandOptions) => {
      await runCommand(
        () =>
          runElementCommand<Parameters<typeof domSubmit>[0], SubmitResult>({
            selectorOrIndex,
            index: options.index,
            buildRequest: (target) => ({
              ...target,
              ...(options.waitNavigation !== undefined && {
                waitNavigation: options.waitNavigation,
              }),
              waitNetwork: options.waitNetwork,
              timeout: options.timeout,
            }),
            call: domSubmit,
            command: 'submit',
            action: 'submit form',
            failureSuggestion: 'Verify the selector matches a form or submit button',
          }),
        options,
        formatSubmitOutput
      );
    });

  domCommand
    .command('pressKey')
    .description('Press a key on an element (for Enter-to-submit, keyboard navigation)')
    .argument('<selectorOrIndex>', 'CSS selector or numeric index from query results (0-based)')
    .argument('<key>', 'Key to press (Enter, Tab, Escape, Space, ArrowUp, etc.)')
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--times <n>', 'Press key multiple times (default: 1)', integerOption(1, 1000))
    .option(
      '--modifiers <mods>',
      'Modifier keys: shift,ctrl,alt,meta (comma-separated; aliases cmd, control, option)',
      modifiersOption
    )
    .option('--no-wait', 'Skip waiting for network stability after key press')
    .addOption(jsonOption())
    .action(async (selectorOrIndex: string, key: string, options: PressKeyCommandOptions) => {
      await runCommand(
        () =>
          runElementCommand<Parameters<typeof domPressKey>[0], PressKeyResult>({
            selectorOrIndex,
            index: options.index,
            buildRequest: (target) => ({
              ...target,
              key,
              ...(options.times !== undefined && { times: options.times }),
              ...(options.modifiers !== undefined && { modifiers: options.modifiers }),
              wait: options.wait !== false,
            }),
            call: domPressKey,
            command: 'pressKey',
            action: 'press key',
            failureSuggestion: 'Verify the selector matches a focusable element',
          }),
        options,
        formatPressKeyOutput
      );
    });

  domCommand
    .command('scroll')
    .description('Scroll page to element, by pixels, or to page boundaries')
    .argument(
      '[selector]',
      'CSS selector or index from query results to scroll into view (optional)'
    )
    .option('--index <n>', 'Element index if selector matches multiple (0-based)', integerOption(0))
    .option('--down <pixels>', 'Scroll down by pixels', integerOption(0))
    .option('--up <pixels>', 'Scroll up by pixels', integerOption(0))
    .option('--left <pixels>', 'Scroll left by pixels', integerOption(0))
    .option('--right <pixels>', 'Scroll right by pixels', integerOption(0))
    .option('--top', 'Scroll to page top')
    .option('--bottom', 'Scroll to page bottom')
    .option('--no-wait', 'Skip waiting for lazy-loaded content after scroll')
    .addOption(jsonOption())
    .action(async (selector: string | undefined, options: ScrollCommandOptions) => {
      await runCommand(
        async () => {
          const problem = scrollOptionsProblem(selector, options);
          if (problem) {
            const err = scrollOptionsError(problem);
            return {
              success: false,
              error: err.message,
              exitCode: EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: { suggestion: err.suggestion },
            };
          }

          const target = selector
            ? await DomElementResolver.getInstance().resolve(selector, options.index, 'scroll')
            : undefined;
          if (target && !target.success) {
            return {
              success: false,
              error: target.error,
              exitCode: target.exitCode,
              ...(target.suggestion && { errorContext: { suggestion: target.suggestion } }),
            };
          }

          const response = await domScroll({
            ...(target && { selector: target.selector }),
            ...(target?.index !== undefined && { index: target.index }),
            ...(target?.backendNodeId !== undefined && { backendNodeId: target.backendNodeId }),
            ...(options.down !== undefined && { down: options.down }),
            ...(options.up !== undefined && { up: options.up }),
            ...(options.left !== undefined && { left: options.left }),
            ...(options.right !== undefined && { right: options.right }),
            ...(options.top !== undefined && { top: options.top }),
            ...(options.bottom !== undefined && { bottom: options.bottom }),
            wait: options.wait !== false,
          });

          if (response.status === 'error' || !response.data) {
            return {
              success: false,
              error: response.error ?? 'Failed to scroll',
              exitCode: response.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              ...(response.suggestion && { errorContext: { suggestion: response.suggestion } }),
            };
          }

          const result = response.data;
          if (!result.success) {
            return {
              success: false,
              error: result.error ?? 'Failed to scroll',
              exitCode: result.exitCode ?? EXIT_CODES.INVALID_ARGUMENTS,
              errorContext: {
                suggestion: result.suggestion ?? 'Verify the selector exists on the page',
              },
            };
          }

          const { success: _success, ...data } = result;
          return { success: true, data };
        },
        options,
        formatScrollOutput
      );
    });
}

/**
 * The first rule `bdg dom scroll` options break, if any: one target (an
 * element, or offsets/edges), and no opposite directions.
 *
 * @param selector - Selector or index argument
 * @param options - Scroll options
 * @returns Problem, or null when the options are valid
 */
function scrollOptionsProblem(
  selector: string | undefined,
  options: ScrollCommandOptions
): Parameters<typeof scrollOptionsError>[0] | null {
  const vertical = [options.down, options.up, options.top, options.bottom].filter(
    (value) => value !== undefined && value !== false
  ).length;
  const horizontal = [options.left, options.right].filter((value) => value !== undefined).length;
  if (options.index !== undefined && !selector) return 'index-without-selector';
  if (selector && vertical + horizontal > 0) return 'selector-with-offset';
  if (vertical > 1) return 'vertical';
  if (horizontal > 1) return 'horizontal';
  if (!selector && vertical + horizontal === 0) return 'no-target';
  return null;
}

/**
 * Click, double-click, right-click or hover an element.
 *
 * @param selectorOrIndex - Selector or cached index
 * @param options - Command options
 * @param action - Pointer action
 */
async function runPointerCommand(
  selectorOrIndex: string,
  options: ClickCommandOptions,
  action: NonNullable<ClickResult['action']>
): Promise<void> {
  await runCommand(
    () =>
      options.double && options.right
        ? Promise.resolve({
            success: false,
            error: conflictingOptionsMessage('--double', '--right'),
            exitCode: EXIT_CODES.INVALID_ARGUMENTS,
          })
        : runElementCommand<Parameters<typeof domClick>[0], ClickResult>({
            selectorOrIndex,
            index: options.index,
            buildRequest: (target) => ({
              ...target,
              wait: options.wait !== false,
              ...(action !== 'click' && { action }),
            }),
            call: domClick,
            command: action === 'hover' ? 'hover' : 'click',
            action: action === 'hover' ? 'hover element' : 'click element',
            failureSuggestion: 'Verify the selector matches a clickable element',
          }),
    options,
    formatClickOutput
  );
}

/** Action result as returned in `data` (the `success` flag is implied by the envelope). */
type ActionOutput<T> = Omit<T, 'success'>;

/** What every action result may report besides its own details */
interface ActionNotices extends ActionEffects {
  warning?: string | undefined;
  dialogs?: DialogInfo[] | undefined;
  triggeredRequests?: TriggeredRequest[] | undefined;
  triggeredRequestsOmitted?: number | undefined;
}

/**
 * Build an action's output: the status line ("✓ Element Clicked",
 * "⚠ Element Clicked (with warnings)" with the warning right below it, or
 * "⚠ Element Clicked (no visible effect: …)"), the details, what changed on
 * the page (`Page:` navigation, `New text:` messages), then the network
 * requests it triggered and the dialogs it caused. No request list is shown
 * when there were none (JSON has an empty `triggeredRequests` then).
 *
 * @param done - What was done, e.g. "Element Clicked"
 * @param details - Label/value rows
 * @param result - Action result
 * @param keyWidth - Width of the labels
 * @returns Output being built (more can be appended)
 */
function formatActionOutput(
  done: string,
  details: Array<[string, string]>,
  result: ActionNotices,
  keyWidth = 15
): OutputFormatter {
  const fmt = new OutputFormatter();
  fmt.text(actionStatusLine(done, result.warning !== undefined, result.effect === 'none'));
  if (result.warning) fmt.text(`⚠ Warning: ${result.warning}`);
  fmt.blank();
  fmt.keyValueList(details, keyWidth);
  if (result.navigation) fmt.keyValue('Page', pageNavigationText(result.navigation), keyWidth);
  (result.messages ?? []).forEach((message, index) => {
    const text = newMessageText(message);
    if (index === 0) fmt.keyValue('New text', text, keyWidth);
    else fmt.text(' '.repeat(keyWidth) + text);
  });

  const omitted = result.triggeredRequestsOmitted;
  const requests = formatTriggeredRequestLines(result.triggeredRequests ?? [], omitted);
  if (requests.length > 0) {
    fmt
      .blank()
      .section(formatTriggeredRequestsTitle(result.triggeredRequests ?? [], omitted), requests);
  }
  for (const dialog of result.dialogs ?? []) {
    fmt.blank();
    fmt.text(`Dialog: ${dialogConsoleText(dialog)}`);
  }
  return fmt;
}

/**
 * Row naming the element an action hit, e.g.
 * `Element: input.toggle in div.view "Write report"` (just its tag when the
 * page could not describe it).
 *
 * @param result - Action result
 * @returns Label/value row
 */
function elementRow(result: {
  element?: string | undefined;
  elementType?: string | undefined;
}): [string, string] {
  if (result.element === undefined) return ['Element Type', result.elementType ?? 'unknown'];
  const viaLabel = result.elementType?.endsWith(VIA_LABEL_SUFFIX) ? VIA_LABEL_SUFFIX : '';
  return ['Element', `${result.element}${viaLabel}`];
}

/**
 * Format fill command output for human-readable display.
 */
function formatFillOutput(result: ActionOutput<FillResult>): string {
  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    elementRow(result),
  ];

  if (result.inputType) details.push(['Input Type', result.inputType]);
  if (result.checked !== undefined) {
    details.push(['Checked', result.checked ? 'true' : 'false']);
  } else if (result.value !== undefined) {
    details.push(['Value', result.value === '' ? '(empty)' : result.value]);
  }

  return formatActionOutput('Element Filled', details, result).build();
}

/**
 * Format click command output for human-readable display.
 */
function formatClickOutput(result: ActionOutput<ClickResult>): string {
  return formatActionOutput(
    `Element ${POINTER_ACTION_DONE[result.action ?? 'click']}`,
    [
      ['Selector', result.selector ?? 'unknown'],
      elementRow(result),
      ['Method', result.method === 'dom' ? 'DOM events' : 'mouse events'],
    ],
    result
  ).build();
}

/**
 * Format submit command output for human-readable display.
 */
function formatSubmitOutput(result: ActionOutput<SubmitResult>): string {
  const details: [string, string][] = [
    ['Selector', result.selector ?? 'unknown'],
    ...(result.element !== undefined ? [elementRow(result)] : []),
    ['Submit Button', result.clicked ? 'used' : 'none'],
  ];

  if (result.networkRequests !== undefined)
    details.push(['Network Requests', result.networkRequests.toString()]);
  if (result.navigationOccurred === false) details.push(['Navigation', 'no']);
  if (result.navigationOccurred && !result.navigation) details.push(['Navigation', 'yes']);
  if (result.waitTimeMs !== undefined) details.push(['Wait Time', `${result.waitTimeMs}ms`]);

  const fmt = formatActionOutput('Form Submitted', details, result, 20);
  fmt.hints('Next steps:', [
    `${sessionCommand('bdg network list --last 10').padEnd(32)} Check network requests`,
    `${sessionCommand('bdg console --last 5').padEnd(32)} Check console messages`,
    `${sessionCommand('bdg status').padEnd(32)} Check session state`,
  ]);
  return fmt.build();
}

/**
 * Format pressKey command output for human-readable display.
 */
function formatPressKeyOutput(result: ActionOutput<PressKeyResult>): string {
  const details: [string, string][] = [
    ['Key', result.key ?? 'unknown'],
    ['Selector', result.selector ?? 'unknown'],
    elementRow(result),
  ];

  if (result.times && result.times > 1) details.push(['Times', result.times.toString()]);
  if (result.modifiers?.length) details.push(['Modifiers', result.modifiers.join('+')]);

  return formatActionOutput('Key Pressed', details, result).build();
}

/**
 * Format scroll command output for human-readable display.
 */
function formatScrollOutput(result: ActionOutput<ScrollResult>): string {
  const details: [string, string][] = [['Scroll Type', result.scrollType]];
  if (result.selector) details.push(['Selector', result.selector]);
  if (result.element) details.push(elementRow(result));
  if (result.scrolledTo)
    details.push(['Position', `(${result.scrolledTo.x}, ${result.scrolledTo.y})`]);
  if (result.scrolledBy && (result.scrolledBy.x !== 0 || result.scrolledBy.y !== 0))
    details.push(['Scrolled By', `(${result.scrolledBy.x}, ${result.scrolledBy.y})`]);
  if (result.viewportSize)
    details.push(['Viewport', `${result.viewportSize.width}×${result.viewportSize.height}`]);
  if (result.pageSize)
    details.push(['Page Size', `${result.pageSize.width}×${result.pageSize.height}`]);

  return formatActionOutput('Page Scrolled', details, result).build();
}
