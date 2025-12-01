import type { Command } from 'commander';

import { normalizeMethod } from '@/cdp/protocol.js';
import {
  getAllDomainSummaries,
  getDomainMethods,
  getDomainSummary,
  getMethodSchema,
} from '@/cdp/schema.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import type { CdpCommandOptions } from '@/commands/shared/optionTypes.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { CommandError } from '@/ui/errors/index.js';
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

/**
 * Method-specific notes for methods with non-obvious behavior.
 */
const METHOD_NOTES: Record<string, string> = {
  'Audits.checkContrast':
    'This method triggers contrast analysis but results are sent via Audits.issueAdded events. ' +
    'Alternative: bdg dom eval with getComputedStyle() for direct contrast checking.',
  'Audits.enable': 'Enables the Audits domain. Issues will arrive via Audits.issueAdded events.',
  'Overlay.highlightNode':
    'Highlights a node visually. Returns empty on success. Use Overlay.hideHighlight to clear.',
  'Profiler.start':
    'Starts CPU profiling. Returns empty. Call Profiler.stop to get the profile data.',
  'Tracing.start': 'Starts tracing. Returns empty. Data arrives via events after Tracing.end.',
};

/**
 * Check if a CDP result is empty (null, undefined, or empty object).
 */
function isEmptyResult(result: unknown): boolean {
  if (result === null || result === undefined) {
    return true;
  }
  if (typeof result === 'object' && Object.keys(result).length === 0) {
    return true;
  }
  return false;
}

/**
 * Get contextual hint for a method based on domain notes and result.
 */
function getMethodHint(methodName: string, result: unknown): string | undefined {
  if (METHOD_NOTES[methodName]) {
    return METHOD_NOTES[methodName];
  }

  const domain = methodName.split('.')[0];
  if (domain && DOMAIN_NOTES[domain] && isEmptyResult(result)) {
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
    .description(
      'CDP protocol introspection and execution (53 domains, 300+ methods)\n' +
        '  Discovery: --list, --search, --describe\n' +
        '  Execution: case-insensitive (network.getcookies works)'
    )
    .argument('[method]', 'CDP method name (e.g., Network.getCookies, network.getcookies)')
    .option('--params <json>', 'Method parameters as JSON')
    .option('--list', 'List all domains or methods in a domain')
    .option('--describe', 'Show method signature and parameters')
    .option('--search <query>', 'Search methods by keyword')
    .action(async (method: string | undefined, options: CdpCommandOptions) => {
      await runCommand(
        async (opts) => {
          if (opts.search) {
            return await handleSearch(opts.search);
          }

          if (opts.list && !method) {
            return handleListDomains();
          }

          if (opts.list && method) {
            return handleListDomainMethods(method);
          }

          if (opts.describe && method) {
            return handleDescribeMethod(method);
          }

          if (method) {
            return await handleExecuteMethod(method, opts.params);
          }

          throw new CommandError(
            'Missing required argument or flag',
            {
              suggestion:
                'Usage: bdg cdp [method] [--params <json>] [--list] [--describe] [--search <query>]',
            },
            EXIT_CODES.INVALID_ARGUMENTS
          );
        },
        { ...options, json: true }
      );
    });
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
 * Handle search mode: Find methods by keyword.
 *
 * @param query - Search query
 * @returns Success result with matching methods
 */
async function handleSearch(query: string): Promise<{ success: true; data: unknown }> {
  const { searchMethods } = await import('@/cdp/schema.js');
  const results = searchMethods(query);

  return {
    success: true,
    data: {
      query,
      count: results.length,
      methods: results.map((m) => ({
        name: m.name,
        domain: m.domain,
        method: m.method,
        description: m.description,
        experimental: m.experimental,
        deprecated: m.deprecated,
        parameterCount: m.parameters.length,
        example: m.example?.command,
      })),
    },
  };
}

/**
 * Handle list domains mode: Show all available domains.
 *
 * @returns Success result with domain summaries
 */
function handleListDomains(): { success: true; data: unknown } {
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
function handleListDomainMethods(domainName: string): {
  success: boolean;
  data?: unknown;
  error?: string;
  exitCode?: number;
  errorContext?: Record<string, unknown>;
} {
  const summary = getDomainSummary(domainName);
  if (!summary) {
    return {
      success: false,
      error: `Domain '${domainName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: 'Use: bdg cdp --list (to see all domains)',
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
        example: m.example?.command,
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
function handleDescribeMethod(methodName: string): {
  success: boolean;
  data?: unknown;
  error?: string;
  exitCode?: number;
  errorContext?: Record<string, unknown>;
} {
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
      example: schema.example,
    },
  };
}

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
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  exitCode?: number;
  errorContext?: Record<string, unknown>;
  hint?: string;
}> {
  const normalized = normalizeMethod(methodName);
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
        error: `Error parsing --params: ${getErrorMessage(error)}. Parameters must be valid JSON.`,
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

  const result: {
    success: boolean;
    data: { method: string; result: unknown };
    hint?: string;
  } = {
    success: true,
    data: {
      method: normalized,
      result: cdpResult,
    },
  };

  if (response.data?.hint) {
    result.hint = response.data.hint;
  }

  const methodHint = getMethodHint(normalized, cdpResult);
  if (methodHint) {
    result.hint = result.hint ? `${result.hint}\n${methodHint}` : methodHint;
  }

  return result;
}
