import type { Command } from 'commander';

import { normalizeMethod } from '@/cdp/protocol.js';
import {
  getAllDomainSummaries,
  getDomainMethods,
  getDomainSummary,
  getMethodSchema,
} from '@/cdp/schema.js';
import type { BaseCommandOptions } from '@/commands/shared/CommandRunner.js';
import { runCommand } from '@/commands/shared/CommandRunner.js';
import { callCDP } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import { CommandError, getErrorMessage } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Options for the `bdg cdp` command.
 */
interface CdpOptions extends BaseCommandOptions {
  /** CDP method parameters as JSON string */
  params?: string;
  /** List all domains or methods in a domain */
  list?: boolean;
  /** Describe a method's signature and parameters */
  describe?: boolean;
  /** Search methods by keyword */
  search?: string;
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
    .action(async (method: string | undefined, options: CdpOptions) => {
      await runCommand(
        async (opts) => {
          // Mode 1: Search methods
          if (opts.search) {
            return await handleSearch(opts.search);
          }

          // Mode 2: List all domains
          if (opts.list && !method) {
            return handleListDomains();
          }

          // Mode 3: List domain methods
          if (opts.list && method) {
            return handleListDomainMethods(method);
          }

          // Mode 4: Describe method
          if (opts.describe && method) {
            return handleDescribeMethod(method);
          }

          // Mode 5: Execute method
          if (method) {
            return await handleExecuteMethod(method, opts.params);
          }

          // No mode selected - show help
          throw new CommandError(
            'Missing required argument or flag',
            {
              suggestion:
                'Usage: bdg cdp [method] [--params <json>] [--list] [--describe] [--search <query>]',
            },
            EXIT_CODES.INVALID_ARGUMENTS
          );
        },
        { ...options, json: true } // Always output JSON for CDP commands
      );
    });
}

/**
 * Calculate Levenshtein distance between two strings.
 * Used for finding similar method names.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance between strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  const firstRow = matrix[0];
  if (firstRow) {
    for (let j = 0; j <= len2; j++) {
      firstRow[j] = j;
    }
  }

  for (let i = 1; i <= len1; i++) {
    const currentRow = matrix[i];
    if (!currentRow) continue;

    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + cost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
  }

  return matrix[len1]?.[len2] ?? 0;
}

/**
 * Find similar methods to suggest when a method is not found.
 * Returns up to 3 closest matches based on edit distance.
 *
 * @param methodName - The method name that was not found
 * @param domain - Optional domain to search within
 * @returns Array of similar method names
 */
function findSimilarMethods(methodName: string, domain?: string): string[] {
  const allDomains = getAllDomainSummaries();
  const candidates: Array<{ name: string; distance: number }> = [];

  const searchName = methodName.toLowerCase();

  for (const domainSummary of allDomains) {
    // If domain specified, only search that domain
    if (domain && domainSummary.name.toLowerCase() !== domain.toLowerCase()) {
      continue;
    }

    const methods = getDomainMethods(domainSummary.name);
    for (const method of methods) {
      const fullName = method.name.toLowerCase();
      const methodOnly = method.method.toLowerCase();

      // Calculate distance for both full name and method name
      const distanceFull = levenshteinDistance(searchName, fullName);
      const distanceMethod = levenshteinDistance(searchName, methodOnly);

      // Use the smaller distance
      const distance = Math.min(distanceFull, distanceMethod);

      // Only consider if distance is reasonable (less than half the length)
      if (distance <= Math.max(searchName.length / 2, 3)) {
        candidates.push({ name: method.name, distance });
      }
    }
  }

  // Sort by distance and return top 3
  return candidates
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((c) => c.name);
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
  // Parse domain and method
  const [domainName, method] = methodName.includes('.')
    ? methodName.split('.')
    : [methodName, undefined];

  if (!method) {
    // If no dot, assume it's just a domain - show domain summary
    const summary = getDomainSummary(domainName);
    if (!summary) {
      const similar = findSimilarMethods(methodName);
      const suggestions = ['Use: bdg cdp --list (to see all domains)'];
      if (similar.length > 0) {
        suggestions.push('');
        suggestions.push('Did you mean:');
        similar.forEach((name) => suggestions.push(`  • ${name}`));
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
        nextStep: `Use: bdg cdp ${summary.name} --list (to see all methods)`,
      },
    };
  }

  // Get method schema
  const schema = getMethodSchema(domainName, method);
  if (!schema) {
    const similar = findSimilarMethods(methodName, domainName);
    const suggestions = [`Use: bdg cdp ${domainName} --list (to see all ${domainName} methods)`];
    if (similar.length > 0) {
      suggestions.push('');
      suggestions.push('Did you mean:');
      similar.forEach((name) => suggestions.push(`  • ${name}`));
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
}> {
  // Normalize method name (case-insensitive)
  const normalized = normalizeMethod(methodName);
  if (!normalized) {
    const similar = findSimilarMethods(methodName);
    const suggestions = ['Use: bdg cdp --search <keyword> (to search for methods)'];
    if (similar.length > 0) {
      suggestions.push('');
      suggestions.push('Did you mean:');
      similar.forEach((name) => suggestions.push(`  • ${name}`));
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

  // Parse parameters if provided
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

  // Send CDP call request to daemon
  const response = await callCDP(normalized, params);

  // Validate IPC response (throws on error)
  validateIPCResponse(response);

  return {
    success: true,
    data: {
      method: normalized,
      result: response.data?.result,
    },
  };
}
