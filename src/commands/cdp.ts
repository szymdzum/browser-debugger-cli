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
import { validateIPCResponse } from '@/ipc/responseValidator.js';
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
    .description('Execute CDP methods with full protocol introspection')
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
            return await handleListDomains();
          }

          // Mode 3: List domain methods
          if (opts.list && method) {
            return await handleListDomainMethods(method);
          }

          // Mode 4: Describe method
          if (opts.describe && method) {
            return await handleDescribeMethod(method);
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
async function handleListDomains(): Promise<{ success: true; data: unknown }> {
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
async function handleListDomainMethods(
  domainName: string
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  exitCode?: number;
  errorContext?: unknown;
}> {
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
async function handleDescribeMethod(
  methodName: string
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  exitCode?: number;
  errorContext?: unknown;
}> {
  // Parse domain and method
  const [domainName, method] = methodName.includes('.')
    ? methodName.split('.')
    : [methodName, undefined];

  if (!method) {
    // If no dot, assume it's just a domain - show domain summary
    const summary = getDomainSummary(domainName);
    if (!summary) {
      return {
        success: false,
        error: `Domain or method '${methodName}' not found`,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        errorContext: {
          suggestion: 'Use: bdg cdp --list (to see all domains)',
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
    return {
      success: false,
      error: `Method '${methodName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: `Use: bdg cdp ${domainName} --list (to see all ${domainName} methods)`,
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
  errorContext?: unknown;
}> {
  // Normalize method name (case-insensitive)
  const normalized = normalizeMethod(methodName);
  if (!normalized) {
    return {
      success: false,
      error: `Method '${methodName}' not found`,
      exitCode: EXIT_CODES.INVALID_ARGUMENTS,
      errorContext: {
        suggestion: 'Use: bdg cdp --search <keyword> (to search for methods)',
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
