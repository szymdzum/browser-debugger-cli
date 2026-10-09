import { Option, type Command } from 'commander';

import { resolveMethodTarget } from '@/cdp/methodTarget.js';
import { getBundledProtocolVersion } from '@/cdp/protocol.js';
import {
  getAllDomainSummaries,
  getDomainMethods,
  getProtocolCounts,
  getDomainSummary,
  getMethodSchema,
  getTypeSchema,
  type MethodSchema,
  type ParameterSchema,
} from '@/cdp/schema.js';
import {
  COLLECT_DEFAULT_TIMEOUT_S,
  collectHints,
  EVENT_WAIT_MAX_S,
  planEventCommand,
  runEventsRequest,
} from '@/commands/cdpEvents.js';
import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CdpCommandOptions } from '@/commands/shared/optionTypes.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  cdpMethodNotFoundError,
  cdpMethodNotInBundledProtocolError,
  cdpMethodTypoError,
  cdpTypeNotMethodError,
  emptyCdpSearchError,
  missingArgumentError,
  scriptExecutionError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { CdpCollectedEvents, CdpCollectParams } from '@/ipc/protocol/cdpEventTypes.js';
import { describeException } from '@/runtime/dom/evalHelpers.js';
import {
  formatCdpDescription,
  formatCdpDomainMethods,
  formatCdpDomains,
  formatCdpResult,
  formatCdpSearch,
  isEmptyCdpResult,
  type CdpDomainDescription,
  type CdpDomainListData,
  type CdpDomainMethodsData,
  type CdpExecuteData,
  type CdpMethodDescription,
  type CdpSearchData,
  type CdpTypeDescription,
} from '@/ui/formatters/cdp.js';
import {
  formatCdpEventCommand,
  type CdpCollectData,
  type CdpEventCommandData,
  type CdpEventsCommandData,
} from '@/ui/formatters/cdpEvents.js';
import {
  CDP_EVENTS_HELP,
  FETCH_ENABLE_NOTE,
  HEAP_SNAPSHOT_COLLECT_COMMAND,
  TRACING_COLLECT_COMMAND,
} from '@/ui/messages/cdpEvents.js';
import { CDP_EXECUTION_HELP, cdpUnlistedMethodWarning } from '@/ui/messages/commands.js';
import { formatHint } from '@/ui/messages/hints.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { findSimilar } from '@/utils/suggestions.js';

/**
 * Domain-specific notes for event-based or special behavior CDP domains.
 *
 * These notes are shown in --describe output and when methods return empty results.
 * Helps agents understand async/event-based CDP patterns that don't fit request-response model.
 */
const DOMAIN_NOTES: Record<string, string> = {
  Audits:
    'Event-based domain. Results arrive via events (e.g., Audits.issueAdded), not method responses. ' +
    "For contrast checking, use: bdg dom eval 'getComputedStyle(el).color'",
  Overlay:
    'Visual debugging domain. Methods like highlightNode show overlays but return empty. ' +
    'Use Overlay.hideHighlight to clear.',
  Profiler:
    'Sampling profiler. Call Profiler.start, perform actions, then Profiler.stop to get results.',
  HeapProfiler:
    'Heap profiler. A snapshot arrives as HeapProfiler.addHeapSnapshotChunk events: ' +
    HEAP_SNAPSHOT_COLLECT_COMMAND,
  Tracing:
    'Performance tracing. Call Tracing.start, perform actions, then collect the trace (Tracing.dataCollected events): ' +
    TRACING_COLLECT_COMMAND,
};

/** Usage of `bdg cdp`, suggested when it gets neither a method nor a flag */
const CDP_USAGE =
  'Usage: bdg cdp [method] [--params <json>] [--list] [--describe] [--search <query>] [--collect <events>] [--listen <events>] [--events [events]]';

/**
 * Domain and method counts of the bundled protocol, for the help text.
 *
 * @returns e.g. "59 domains, 675 methods"
 */
function cdpCountsText(): string {
  const counts = getProtocolCounts();
  return `${counts.domains} domains, ${counts.methods} methods`;
}

/**
 * Method-specific notes for methods with non-obvious behavior.
 */
const METHOD_NOTES: Record<string, string> = {
  'Audits.enable': 'Enables the Audits domain. Issues will arrive via Audits.issueAdded events.',
  'Overlay.highlightNode':
    'Highlights a node visually. Returns empty on success. Use Overlay.hideHighlight to clear.',
  'Profiler.start':
    'Starts CPU profiling. Returns empty. Call Profiler.stop to get the profile data.',
  'Tracing.start': `Starts tracing. Returns empty. End it and collect the trace with: ${TRACING_COLLECT_COMMAND}`,
  'Fetch.enable': FETCH_ENABLE_NOTE,
};

/**
 * Get contextual hint for a method based on domain notes and result.
 */
function getMethodHint(methodName: string, result: unknown): string | undefined {
  if (METHOD_NOTES[methodName]) {
    return METHOD_NOTES[methodName];
  }

  const domain = methodName.split('.')[0];
  if (domain && DOMAIN_NOTES[domain] && isEmptyCdpResult(result)) {
    return DOMAIN_NOTES[domain];
  }

  return undefined;
}

/**
 * Register CDP command with full introspection support.
 *
 * Supports multiple modes:
 * - Execution: `bdg cdp Network.getCookies --params '{...}'`
 * - List domains: `bdg cdp --list`
 * - List methods: `bdg cdp Network --list`
 * - Describe method: `bdg cdp Network.getCookies --describe`
 * - Search: `bdg cdp --search cookie`
 *
 * All modes support case-insensitive input and provide structured JSON output.
 *
 * @param program - Commander.js Command instance to register commands on
 */
export function registerCdpCommand(program: Command): void {
  program
    .command('cdp')
    .summary('CDP protocol introspection and execution')
    .description(
      'CDP protocol introspection and execution\n' +
        '  Discovery: --list, --search, --describe\n' +
        CDP_EXECUTION_HELP
    )
    .argument('[method]', 'CDP method name (e.g., Network.getCookies, network.getcookies)')
    .addOption(new Option('--params <json>', 'Method parameters as JSON'))
    .addOption(
      new Option('--list', 'List all domains or methods in a domain').conflicts([
        'describe',
        'params',
      ])
    )
    .addOption(new Option('--describe', 'Show method signature and parameters').conflicts('params'))
    .addOption(
      new Option(
        '--send-anyway',
        'Send a Domain.method that looks like a typo of a bundled one as typed'
      ).conflicts(['list', 'describe', 'search'])
    )
    .addOption(
      new Option('--search <query>', 'Search methods by keyword').conflicts([
        'list',
        'describe',
        'params',
      ])
    )
    .addOption(
      eventOption(
        '--collect <events>',
        'Collect these events (comma-separated) while the method runs'
      )
    )
    .addOption(
      eventOption('--until <event>', 'With a method: stop collecting when this event arrives')
    )
    .addOption(
      eventOption(
        '--timeout <seconds>',
        `Collect for at most this long (default ${COLLECT_DEFAULT_TIMEOUT_S}, max ${EVENT_WAIT_MAX_S})`
      )
    )
    .addOption(eventOption('--out <file>', 'Write collected or read events to a file (NDJSON)'))
    .addOption(
      eventOption(
        '--listen <events>',
        'Buffer these events (comma-separated) between commands'
      ).conflicts(['events', 'unlisten', 'collect', 'until'])
    )
    .addOption(
      eventOption('--events [events]', 'Read and remove buffered events (all, or these)').conflicts(
        ['unlisten', 'collect', 'until', 'params']
      )
    )
    .addOption(
      eventOption('--wait <seconds>', `With --events: wait for an event (max ${EVENT_WAIT_MAX_S})`)
    )
    .addOption(
      eventOption('--clear', 'With --events: discard the events instead of returning them')
    )
    .addOption(
      eventOption('--unlisten', 'Stop listening and discard the buffer').conflicts([
        'collect',
        'until',
        'params',
      ])
    )
    .addOption(jsonOption())
    .addHelpText('after', () => `\n${CDP_EVENTS_HELP}\n\nBundled protocol: ${cdpCountsText()}`)
    .action(async (method: string | undefined, options: CdpCommandOptions) => {
      await runCdpCommand(method, options);
    });
}

/**
 * An event option, which discovery modes cannot take.
 *
 * @param flags - Option flags
 * @param description - Help text
 * @returns Option
 */
function eventOption(flags: string, description: string): Option {
  return new Option(flags, description).conflicts(['list', 'describe', 'search']);
}

/** Options of the event modes */
const EVENT_FLAGS = [
  'collect',
  'until',
  'timeout',
  'out',
  'listen',
  'events',
  'wait',
  'clear',
  'unlisten',
] as const satisfies readonly (keyof CdpCommandOptions)[];

/**
 * Run the `bdg cdp` mode the options select, with its human-readable output.
 *
 * @param method - Method or domain argument
 * @param options - Command options (exits 81 when neither a method nor a
 *   discovery flag is given)
 */
async function runCdpCommand(
  method: string | undefined,
  options: CdpCommandOptions
): Promise<void> {
  if (EVENT_FLAGS.some((flag) => options[flag] !== undefined)) {
    return runCommand(
      async () => handleEventCommand(method, options),
      options,
      formatCdpEventCommand
    );
  }
  if (options.search !== undefined) {
    const query = options.search;
    return runCommand(async () => handleSearch(query, method), options, formatCdpSearch);
  }
  if (method && (options.list || isBareDomain(method, options))) {
    return runCommand(async () => handleListDomainMethods(method), options, formatCdpDomainMethods);
  }
  if (options.list) return runCommand(async () => handleListDomains(), options, formatCdpDomains);
  if (options.describe && method) {
    return runCommand(async () => handleDescribeMethod(method), options, formatCdpDescription);
  }
  if (method) {
    return runCommand(async () => handleExecuteMethod(method, options), options, formatCdpResult);
  }
  return runCommand(async () => {
    const err = missingArgumentError(CDP_USAGE);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }, options);
}

/**
 * Whether the argument names a domain without a method and nothing asks to
 * run it (`bdg cdp Network`): its methods are listed, as with `--list`.
 *
 * @param method - Method or domain argument
 * @param options - Command options
 * @returns True for a bare domain name
 */
export function isBareDomain(method: string, options: CdpCommandOptions): boolean {
  return (
    !method.includes('.') &&
    options.params === undefined &&
    !options.describe &&
    getDomainSummary(method) !== undefined
  );
}

/**
 * The page exception a method reported in its result (`Runtime.evaluate`,
 * `Runtime.callFunctionOn`, ... answer a script that threw with
 * `exceptionDetails`), as an error result like `dom eval`'s (exit 91).
 *
 * @param result - Method result
 * @returns Error result, or undefined when the result has no exception
 */
export function pageExceptionResult(result: unknown): CommandResult<CdpExecuteData> | undefined {
  if (typeof result !== 'object' || result === null || !('exceptionDetails' in result)) {
    return undefined;
  }
  const details = (result as { exceptionDetails: Protocol.Runtime.ExceptionDetails })
    .exceptionDetails;
  const err = scriptExecutionError(describeException(details));
  return {
    success: false,
    error: err.message,
    exitCode: EXIT_CODES.SCRIPT_ERROR,
    errorContext: { suggestion: err.suggestion },
  };
}

/**
 * Find similar methods to suggest when a method is not found.
 * Returns up to 3 closest matches based on edit distance.
 *
 * Uses the shared findSimilar utility for consistency with other typo detection.
 *
 * @param methodName - The method name that was not found
 * @param domain - Optional domain to search within
 * @returns Array of similar method names
 */
function findSimilarMethods(methodName: string, domain?: string): string[] {
  const allDomains = getAllDomainSummaries();
  const candidates: string[] = [];

  for (const domainSummary of allDomains) {
    if (domain && domainSummary.name.toLowerCase() !== domain.toLowerCase()) {
      continue;
    }

    const methods = getDomainMethods(domainSummary.name);
    for (const method of methods) {
      candidates.push(method.name);
    }
  }

  return findSimilar(methodName, candidates, {
    maxDistance: Math.max(Math.floor(methodName.length / 2), 3),
    maxSuggestions: 3,
    caseInsensitive: true,
  });
}

/**
 * Did-you-mean for an unknown domain, or how to list them.
 *
 * @param domainName - Domain as typed
 * @returns Suggestion
 */
function domainSuggestion(domainName: string): string {
  const [closest] = findSimilar(
    domainName,
    getAllDomainSummaries().map((summary) => summary.name)
  );
  return closest
    ? `Did you mean: bdg cdp ${closest} --list?`
    : 'Use: bdg cdp --list (to see all domains)';
}

/**
 * For a method bdg refuses to run, what to use instead (shown as its example).
 *
 * @param methodName - Full method name, e.g. Page.captureScreenshot
 * @returns Alternative command, or undefined for methods that run
 */
function blockedAlternative(methodName: string): string | undefined {
  const blocked = BLOCKED_CDP_METHODS[methodName];
  return blocked && `${sessionCommand(blocked.alternative)} (raw ${methodName} is blocked)`;
}

/**
 * Handle search mode: Find methods by keyword.
 *
 * @param query - Search query
 * @param domain - Domain to search in (`bdg cdp Network --search cookie`)
 * @returns Success result with matching methods
 */
async function handleSearch(query: string, domain?: string): Promise<CommandResult<CdpSearchData>> {
  if (!query.trim()) {
    const err = emptyCdpSearchError();
    return {
      success: false,
      error: err.message,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: err.suggestion },
    };
  }
  if (domain !== undefined && !getDomainSummary(domain)) {
    return {
      success: false,
      error: `Domain '${domain}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: domainSuggestion(domain) },
    };
  }
  const { searchMethods } = await import('@/cdp/schema.js');
  const results = searchMethods(query.trim()).filter(
    (m) => domain === undefined || m.domain.toLowerCase() === domain.toLowerCase()
  );

  return {
    success: true,
    data: {
      query: query.trim(),
      count: results.length,
      methods: results.map((m) => ({
        name: m.name,
        domain: m.domain,
        method: m.method,
        description: m.description,
        experimental: m.experimental,
        deprecated: m.deprecated,
        parameterCount: m.parameters.length,
        example: blockedAlternative(m.name) ?? m.example?.command,
      })),
    },
  };
}

/**
 * Handle list domains mode: Show all available domains.
 *
 * @returns Success result with domain summaries
 */
function handleListDomains(): CommandResult<CdpDomainListData> {
  const summaries = getAllDomainSummaries();

  return {
    success: true,
    data: {
      count: summaries.length,
      domains: summaries.map((s) => ({
        name: s.name,
        description: s.description,
        commands: s.commandCount,
        events: s.eventCount,
        experimental: s.experimental,
        deprecated: s.deprecated,
        dependencies: s.dependencies,
      })),
    },
  };
}

/**
 * Handle list domain methods mode: Show all methods in a domain.
 *
 * @param domainName - Domain name (case-insensitive)
 * @returns Success result with method summaries
 */
function handleListDomainMethods(domainName: string): CommandResult<CdpDomainMethodsData> {
  const summary = getDomainSummary(domainName);
  if (!summary) {
    return {
      success: false,
      error: `Domain '${domainName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: domainSuggestion(domainName),
      },
    };
  }

  const methods = getDomainMethods(domainName);

  return {
    success: true,
    data: {
      domain: summary.name,
      description: summary.description,
      count: methods.length,
      methods: methods.map((m) => ({
        name: m.method,
        fullName: m.name,
        description: m.description,
        experimental: m.experimental,
        deprecated: m.deprecated,
        parameterCount: m.parameters.length,
        parameters: m.parameters.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
        })),
        returns: m.returns.map((r) => ({
          name: r.name,
          type: r.type,
        })),
        example: blockedAlternative(m.name) ?? m.example?.command,
      })),
    },
  };
}

/** A description `bdg cdp <name> --describe` gives */
type CdpDescription = CdpMethodDescription | CdpDomainDescription | CdpTypeDescription;

/**
 * Handle describe mode: show a domain, a method's signature and parameters,
 * or a protocol type's values or properties.
 *
 * @param name - Domain, `Domain.method` or `Domain.Type` (case-insensitive)
 * @returns Success result with the description
 */
export function handleDescribeMethod(name: string): CommandResult<CdpDescription> {
  const [domainName = '', member] = name.includes('.') ? name.split('.') : [name, undefined];
  if (!member) return describeDomain(name);

  const schema = getMethodSchema(domainName, member);
  if (schema) return { success: true, data: describeMethod(schema) };
  const type = getTypeSchema(domainName, member);
  if (type) return { success: true, data: { type: 'type', ...type } };

  const target = resolveMethodTarget(name);
  const err =
    target.kind === 'unlisted'
      ? cdpMethodNotInBundledProtocolError(target.method, getBundledProtocolVersion())
      : cdpMethodNotFoundError(
          name,
          findSimilarMethods(name, domainName),
          `Use: bdg cdp ${domainName} --list (to see all ${domainName} methods)`
        );
  return {
    success: false,
    error: err.message,
    exitCode: EXIT_CODES.INVALID_ARGUMENTS,
    errorContext: { suggestion: err.suggestion },
  };
}

/**
 * Describe a domain (`bdg cdp Network --describe`).
 *
 * @param domainName - Domain name (case-insensitive)
 * @returns Domain description, or not found with similar names
 */
function describeDomain(domainName: string): CommandResult<CdpDomainDescription> {
  const summary = getDomainSummary(domainName);
  if (!summary) {
    const err = cdpMethodNotFoundError(
      domainName,
      findSimilarMethods(domainName),
      'Use: bdg cdp --list (to see all domains)'
    );
    return {
      success: false,
      error: `Domain or method '${domainName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: err.suggestion },
    };
  }
  return {
    success: true,
    data: {
      type: 'domain',
      domain: summary.name,
      description: summary.description,
      commands: summary.commandCount,
      events: summary.eventCount,
      experimental: summary.experimental,
      deprecated: summary.deprecated,
      note: DOMAIN_NOTES[summary.name],
      nextStep: `Use: bdg cdp ${summary.name} --list (to see all methods)`,
    },
  };
}

/**
 * A parameter as `--describe` shows it.
 *
 * @param p - Parameter schema
 * @returns Described parameter
 */
function describeParameter(p: ParameterSchema): CdpMethodDescription['parameters'][number] {
  return {
    name: p.name,
    type: p.type,
    required: p.required,
    description: p.description,
    enum: p.enum,
    ref: p.ref,
    refType: p.refType,
    items: p.items,
    experimental: p.experimental,
    deprecated: p.deprecated,
  };
}

/**
 * Describe a method (`bdg cdp Network.getCookies --describe`).
 *
 * @param schema - Method schema
 * @returns Method description with its redirect, note and example
 */
function describeMethod(schema: MethodSchema): CdpMethodDescription {
  const alternative = blockedAlternative(schema.name);
  return {
    type: 'method',
    name: schema.name,
    domain: schema.domain,
    method: schema.method,
    description: schema.description,
    experimental: schema.experimental,
    deprecated: schema.deprecated,
    note: METHOD_NOTES[schema.name] ?? DOMAIN_NOTES[schema.domain],
    parameters: schema.parameters.map(describeParameter),
    returns: schema.returns.map((r) => ({
      name: r.name,
      type: r.type,
      optional: r.optional,
      description: r.description,
      items: r.items,
    })),
    redirect: schema.redirect && {
      method: schema.redirect.method,
      resolved: schema.redirect.resolved,
      parameters: schema.redirect.parameters.map(describeParameter),
    },
    example: alternative ? { command: alternative } : schema.example,
  };
}

/**
 * CDP methods blocked from raw execution: they return large binary data that
 * corrupts terminal/agent sessions, or end the session behind bdg's back.
 */
const BLOCKED_CDP_METHODS: Record<string, { alternative: string; reason: string }> = {
  'Page.captureScreenshot': {
    alternative: 'bdg dom screenshot [path]',
    reason: 'Returns large base64 data that corrupts terminal sessions',
  },
  'Page.close': {
    alternative: 'bdg stop',
    reason: 'Closes the page under the session, which then ends',
  },
  'Browser.close': {
    alternative: 'bdg stop',
    reason: 'Closes Chrome under the session, which then ends without saving its state',
  },
};

/**
 * The method `bdg cdp <name>` sends: a bundled method with its casing, or a
 * well-formed method the bundled protocol lacks, as typed with a warning.
 *
 * @param methodName - Method name as typed
 * @param options - `sendAnyway` sends a close typo of bundled methods as typed
 * @returns Method to send, and the warning for one the bundled protocol lacks
 * @throws CommandError (exit 81) for a blocked method, a type, a close typo
 *   of bundled methods (without `sendAnyway`) or a name that is not `Domain.method`
 */
export function methodToSend(
  methodName: string,
  options: Pick<CdpCommandOptions, 'sendAnyway'> = {}
): { method: string; warning?: string } {
  const target = resolveMethodTarget(methodName);
  if (target.kind === 'known') {
    const blocked = BLOCKED_CDP_METHODS[target.method];
    if (blocked) {
      throw new CommandError(
        `${target.method} is blocked via raw CDP: ${blocked.reason}`,
        { suggestion: `Use: ${sessionCommand(blocked.alternative)}` },
        EXIT_CODES.INVALID_ARGUMENTS
      );
    }
    return { method: target.method };
  }
  if (target.kind === 'unlisted' || (target.kind === 'typo' && options.sendAnyway)) {
    return {
      method: target.method,
      warning: cdpUnlistedMethodWarning(target.method, getBundledProtocolVersion()),
    };
  }
  const err =
    target.kind === 'type'
      ? cdpTypeNotMethodError(target.name)
      : unknownMethodError(methodName, target);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Not found, for a close typo of bundled methods or domains, or a name that
 * is not `Domain.method`.
 *
 * @param methodName - Method name as typed
 * @param target - Typo with its suggestions, or malformed
 * @returns Message and suggestion
 */
function unknownMethodError(
  methodName: string,
  target: { kind: 'typo'; suggestions: string[] } | { kind: 'malformed' }
): ErrorWithSuggestion {
  if (target.kind === 'malformed') {
    return cdpMethodNotFoundError(
      methodName,
      findSimilarMethods(methodName),
      'Use: bdg cdp --search <keyword> (to search for methods)'
    );
  }
  const [domainName = ''] = methodName.split('.');
  return target.suggestions.length > 0
    ? cdpMethodTypoError(
        methodName,
        target.suggestions.slice(0, 3),
        'Use: bdg cdp --search <keyword> (to search for methods)'
      )
    : cdpMethodTypoError(methodName, [], domainSuggestion(domainName));
}

/**
 * Add the warning about a method missing from the bundled protocol to the
 * error Chrome gave for it, so a failed call still says it was sent as typed.
 *
 * @param error - Error of the call
 * @param warning - Warning, when the method was not in the bundled protocol
 * @returns The error, with the warning (top-level JSON `warning`) when there is one
 */
function withWarning(error: unknown, warning: string | undefined): unknown {
  if (!warning || !(error instanceof CommandError)) return error;
  return new CommandError(error.message, { ...error.metadata, warning }, error.exitCode);
}

/** A call `bdg cdp` is about to send */
interface PreparedCall {
  method: string;
  params?: Record<string, unknown>;
  /** Warning for a method the bundled protocol lacks */
  warning?: string;
}

/**
 * Check a method and its `--params` before anything is sent.
 *
 * @param methodName - Method name (case-insensitive for bundled methods)
 * @param options - Command options
 * @returns Method, parameters and warning
 * @throws CommandError (81) for a refused method or invalid `--params` JSON
 */
function prepareCall(methodName: string, options: CdpCommandOptions): PreparedCall {
  const { method, warning } = methodToSend(methodName, options);
  const call = { method, ...(warning && { warning }) };
  if (!options.params) return call;
  try {
    return { ...call, params: JSON.parse(options.params) as Record<string, unknown> };
  } catch (error) {
    throw new CommandError(
      `Invalid --params JSON: ${getErrorMessage(error)}`,
      {
        suggestion: `Use: bdg cdp ${method} --describe (to see parameter schema)`,
        ...(warning && { warning }),
      },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
}

/**
 * Send a prepared call, with the events to collect while it runs.
 *
 * @param call - Method, parameters and warning
 * @param collect - Events to collect (`--collect`), if any
 * @param notes - Whether to add the method's note (not when events are read already)
 * @returns Command result, with the collected events
 */
async function sendCall(
  call: PreparedCall,
  collect?: CdpCollectParams,
  notes = !collect
): Promise<CommandResult<CdpExecuteData & Partial<CdpCollectedEvents>>> {
  const response = await callCDP(call.method, call.params, collect ? { collect } : {});
  try {
    validateIPCResponse(response);
  } catch (error) {
    throw withWarning(error, call.warning);
  }
  const ipcHint = response.data?.hint && formatHint(response.data.hint);
  const result = cdpCallResult(call.method, response.data?.result, call.warning, ipcHint, {
    notes,
  });
  const collected = response.data?.collected;
  if (!result.success || !result.data || !collected || !collect) return result;
  const data = { ...result.data, ...collected };
  const hints = [result.hint, ...collectHints(data, collect)].filter(Boolean);
  return { ...result, data, ...(hints.length > 0 && { hint: hints.join('\n') }) };
}

/**
 * Handle execute method mode: Call CDP method.
 *
 * @param methodName - Method name (case-insensitive for bundled methods)
 * @param options - Command options (`--params` as JSON)
 * @returns Success result with method response
 */
async function handleExecuteMethod(
  methodName: string,
  options: CdpCommandOptions
): Promise<CommandResult<CdpExecuteData>> {
  return sendCall(prepareCall(methodName, options));
}

/**
 * Join warnings, leaving out missing ones.
 *
 * @param warnings - Warnings
 * @returns Joined warnings, or undefined
 */
function joinWarnings(...warnings: (string | undefined)[]): string | undefined {
  const present = warnings.filter(Boolean);
  return present.length > 0 ? present.join('\n') : undefined;
}

/**
 * Handle the event modes: collect while a method runs, listen (and call a
 * method once listening), read the buffer, or stop listening.
 *
 * @param methodName - Method argument
 * @param options - Command options
 * @returns Command result
 * @throws CommandError (81) for bad event names or flags, before anything is sent
 */
async function handleEventCommand(
  methodName: string | undefined,
  options: CdpCommandOptions
): Promise<CommandResult<CdpEventCommandData>> {
  const plan = planEventCommand(methodName, options);
  const call = methodName === undefined ? undefined : prepareCall(methodName, options);
  if (plan?.mode === 'unlisten') return runEventsRequest({ action: 'unlisten' });
  if (plan?.mode === 'events') return runEventsRequest(plan.request, plan.warning);
  if (plan?.mode === 'collect' && call) {
    const result = await sendCall(call, plan.collect);
    const warning = joinWarnings(result.warning, plan.warning);
    return { ...result, ...(warning && { warning }) } as CommandResult<CdpCollectData>;
  }
  if (plan?.mode !== 'listen') {
    const err = missingArgumentError(CDP_USAGE);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const listened = await runEventsRequest({ action: 'listen', events: plan.events }, plan.warning);
  if (!call) return listened;
  const called = await sendCall(call, undefined, false).catch((error: unknown) => {
    throw withWarning(error, plan.warning);
  });
  const warning = joinWarnings(called.warning, plan.warning);
  if (!called.success) return { ...called, ...(warning && { warning }) } as CommandResult<never>;
  return {
    ...called,
    data: { ...listened.data, ...called.data } as CdpEventsCommandData,
    ...(warning && { warning }),
    ...(listened.hint && { hint: listened.hint }),
  };
}

/**
 * The result of a CDP call: the page exception it reported (exit 91), or its
 * result with the session's and the method's hints; either way with the
 * warning for a method the bundled protocol lacks.
 *
 * @param method - Method called
 * @param cdpResult - What Chrome returned
 * @param warning - Warning for a method the bundled protocol lacks
 * @param ipcHint - Hint the session gave (e.g. a repeated-call pattern)
 * @param options - `notes: false` leaves out the method's note (a collection already reads its events)
 * @returns Command result
 */
export function cdpCallResult(
  method: string,
  cdpResult: unknown,
  warning?: string,
  ipcHint?: string,
  { notes = true }: { notes?: boolean } = {}
): CommandResult<CdpExecuteData> {
  const withCallWarning = warning ? { warning } : {};
  const exception = pageExceptionResult(cdpResult);
  if (exception) return { ...exception, ...withCallWarning };

  const hints = [ipcHint, notes ? getMethodHint(method, cdpResult) : undefined].filter(Boolean);
  return {
    success: true,
    data: { method, result: cdpResult },
    ...withCallWarning,
    ...(hints.length > 0 && { hint: hints.join('\n') }),
  };
}
