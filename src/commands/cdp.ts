import { Option, type Command } from 'commander';

import { normalizeMethod } from '@/cdp/protocol.js';
import {
  getAllDomainSummaries,
  getDomainMethods,
  getProtocolCounts,
  getDomainSummary,
  getMethodSchema,
} from '@/cdp/schema.js';
import { runCommand, type CommandResult } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { CdpCommandOptions } from '@/commands/shared/optionTypes.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  emptyCdpSearchError,
  missingArgumentError,
  scriptExecutionError,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
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
} from '@/ui/formatters/cdp.js';
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
    'Heap profiler. Results collected via events after takeHeapSnapshot or startSampling.',
  Tracing:
    'Performance tracing. Call Tracing.start, perform actions, then Tracing.end. ' +
    'Data arrives via Tracing.dataCollected events.',
};

/** Usage of `bdg cdp`, suggested when it gets neither a method nor a flag */
const CDP_USAGE =
  'Usage: bdg cdp [method] [--params <json>] [--list] [--describe] [--search <query>]';

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
  'Tracing.start': 'Starts tracing. Returns empty. Data arrives via events after Tracing.end.',
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
        '  Execution: case-insensitive (network.getcookies works)'
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
      new Option('--search <query>', 'Search methods by keyword').conflicts([
        'list',
        'describe',
        'params',
      ])
    )
    .addOption(jsonOption())
    .addHelpText('after', () => `\nBundled protocol: ${cdpCountsText()}`)
    .action(async (method: string | undefined, options: CdpCommandOptions) => {
      await runCdpCommand(method, options);
    });
}

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
    return runCommand(
      async () => handleExecuteMethod(method, options.params),
      options,
      formatCdpResult
    );
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

/**
 * Handle describe method mode: Show method signature and parameters.
 *
 * @param methodName - Method name (case-insensitive, with or without domain)
 * @returns Success result with method schema
 */
function handleDescribeMethod(
  methodName: string
): CommandResult<CdpMethodDescription | CdpDomainDescription> {
  const [domainName, method] = methodName.includes('.')
    ? methodName.split('.')
    : [methodName, undefined];

  if (!method) {
    const summary = getDomainSummary(domainName);
    if (!summary) {
      const similar = findSimilarMethods(methodName);
      const suggestions = ['Use: bdg cdp --list (to see all domains)'];
      if (similar.length > 0) {
        suggestions.push('');
        suggestions.push('Did you mean:');
        similar.forEach((name) => suggestions.push(`  - ${name}`));
      }

      return {
        success: false,
        error: `Domain or method '${methodName}' not found`,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        errorContext: {
          suggestion: suggestions.join('\n'),
        },
      };
    }

    const domainNote = DOMAIN_NOTES[summary.name];
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
        note: domainNote,
        nextStep: `Use: bdg cdp ${summary.name} --list (to see all methods)`,
      },
    };
  }

  const schema = getMethodSchema(domainName, method);
  if (!schema) {
    const similar = findSimilarMethods(methodName, domainName);
    const suggestions = [`Use: bdg cdp ${domainName} --list (to see all ${domainName} methods)`];
    if (similar.length > 0) {
      suggestions.push('');
      suggestions.push('Did you mean:');
      similar.forEach((name) => suggestions.push(`  - ${name}`));
    }

    return {
      success: false,
      error: `Method '${methodName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: suggestions.join('\n'),
      },
    };
  }

  const methodNote = METHOD_NOTES[schema.name] ?? DOMAIN_NOTES[schema.domain];
  const alternative = blockedAlternative(schema.name);
  return {
    success: true,
    data: {
      type: 'method',
      name: schema.name,
      domain: schema.domain,
      method: schema.method,
      description: schema.description,
      experimental: schema.experimental,
      deprecated: schema.deprecated,
      note: methodNote,
      parameters: schema.parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        description: p.description,
        enum: p.enum,
        items: p.items,
        deprecated: p.deprecated,
      })),
      returns: schema.returns.map((r) => ({
        name: r.name,
        type: r.type,
        optional: r.optional,
        description: r.description,
        items: r.items,
      })),
      example: alternative ? { command: alternative } : schema.example,
    },
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
 * Handle execute method mode: Call CDP method.
 *
 * @param methodName - Method name (case-insensitive)
 * @param paramsJson - Parameters as JSON string
 * @returns Success result with method response
 */
async function handleExecuteMethod(
  methodName: string,
  paramsJson?: string
): Promise<CommandResult<CdpExecuteData>> {
  const normalized = normalizeMethod(methodName);

  if (normalized && BLOCKED_CDP_METHODS[normalized]) {
    const blocked = BLOCKED_CDP_METHODS[normalized];
    return {
      success: false,
      error: `${normalized} is blocked via raw CDP: ${blocked.reason}`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: { suggestion: `Use: ${sessionCommand(blocked.alternative)}` },
    };
  }
  if (!normalized) {
    const similar = findSimilarMethods(methodName);
    const suggestions = ['Use: bdg cdp --search <keyword> (to search for methods)'];
    if (similar.length > 0) {
      suggestions.push('');
      suggestions.push('Did you mean:');
      similar.forEach((name) => suggestions.push(`  - ${name}`));
    }

    return {
      success: false,
      error: `Method '${methodName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: suggestions.join('\n'),
      },
    };
  }

  let params: Record<string, unknown> | undefined;
  if (paramsJson) {
    try {
      params = JSON.parse(paramsJson) as Record<string, unknown>;
    } catch (error) {
      return {
        success: false,
        error: `Invalid --params JSON: ${getErrorMessage(error)}`,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        errorContext: {
          suggestion: `Use: bdg cdp ${normalized} --describe (to see parameter schema)`,
        },
      };
    }
  }

  const response = await callCDP(normalized, params);

  validateIPCResponse(response);

  const cdpResult = response.data?.result;
  const exception = pageExceptionResult(cdpResult);
  if (exception) return exception;

  const result: CommandResult<CdpExecuteData> = {
    success: true,
    data: {
      method: normalized,
      result: cdpResult,
    },
  };

  if (response.data?.hint) {
    result.hint = formatHint(response.data.hint);
  }

  const methodHint = getMethodHint(normalized, cdpResult);
  if (methodHint) {
    result.hint = result.hint ? `${result.hint}\n${methodHint}` : methodHint;
  }

  return result;
}
