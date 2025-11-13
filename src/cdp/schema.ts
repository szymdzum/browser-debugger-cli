/**
 * CDP Schema Introspection
 *
 * Provides structured, agent-friendly schema information for all CDP domains and methods.
 * Follows principles from docs/AGENT_FRIENDLY_TOOLS.md:
 * - Machine-readable output (JSON schema)
 * - Self-describing tools
 * - Structured context without verbosity
 */

import type { Domain, Command, Parameter, ReturnValue } from './types.js';

import { loadProtocol, findDomain, findCommand } from './protocol.js';

/**
 * Structured method schema for agent consumption.
 */
export interface MethodSchema {
  /** Full method name (Domain.method) */
  name: string;
  /** Domain name */
  domain: string;
  /** Method name */
  method: string;
  /** Human-readable description */
  description?: string;
  /** Whether method is experimental */
  experimental?: boolean;
  /** Whether method is deprecated */
  deprecated?: boolean;
  /** Parameter schema */
  parameters: ParameterSchema[];
  /** Return value schema */
  returns: ReturnSchema[];
  /** Usage example (JSON) */
  example?: {
    command: string;
    params?: Record<string, unknown>;
  };
}

/**
 * Parameter schema for agent consumption.
 */
export interface ParameterSchema {
  /** Parameter name */
  name: string;
  /** Type (string, integer, boolean, array, object, or custom type reference) */
  type: string;
  /** Whether parameter is required */
  required: boolean;
  /** Human-readable description */
  description?: string;
  /** Enum values (if type is enum) */
  enum?: string[];
  /** Array item type (if type is array) */
  items?: string;
  /** Deprecated flag */
  deprecated?: boolean;
}

/**
 * Return value schema for agent consumption.
 */
export interface ReturnSchema {
  /** Return value name */
  name: string;
  /** Type (string, integer, boolean, array, object, or custom type reference) */
  type: string;
  /** Whether return value is optional */
  optional: boolean;
  /** Human-readable description */
  description?: string;
  /** Array item type (if type is array) */
  items?: string;
}

/**
 * Domain summary for agent consumption.
 */
export interface DomainSummary {
  /** Domain name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Number of commands in this domain */
  commandCount: number;
  /** Number of events in this domain */
  eventCount: number;
  /** Whether domain is experimental */
  experimental?: boolean;
  /** Whether domain is deprecated */
  deprecated?: boolean;
  /** Domain dependencies */
  dependencies?: string[];
}

/**
 * Get structured schema for a specific method.
 *
 * @param domainName - Domain name (case-insensitive)
 * @param methodName - Method name (case-insensitive)
 * @returns Method schema or undefined if not found
 *
 * @example
 * ```typescript
 * const schema = getMethodSchema('Network', 'getCookies');
 * console.log(schema.parameters); // [{ name: 'urls', type: 'array', required: false, ... }]
 * ```
 */
export function getMethodSchema(domainName: string, methodName: string): MethodSchema | undefined {
  const domain = findDomain(domainName);
  if (!domain) {
    return undefined;
  }

  const command = findCommand(domain.domain, methodName);
  if (!command) {
    return undefined;
  }

  return buildMethodSchema(domain.domain, command);
}

/**
 * Build method schema from protocol command.
 *
 * @param domainName - Domain name
 * @param command - Command from protocol
 * @returns Structured method schema
 */
function buildMethodSchema(domainName: string, command: Command): MethodSchema {
  const parameters = command.parameters?.map(paramToSchema) ?? [];
  const returns = command.returns?.map(returnToSchema) ?? [];

  // Generate example
  const example: MethodSchema['example'] = {
    command: `bdg cdp ${domainName}.${command.name}`,
  };

  if (parameters.length > 0) {
    // Create example params with placeholder values
    const exampleParams: Record<string, unknown> = {};
    parameters.forEach((p) => {
      if (!p.required) return; // Skip optional params in example
      exampleParams[p.name] = getExampleValue(p);
    });
    if (Object.keys(exampleParams).length > 0) {
      example.params = exampleParams;
      example.command += ` --params '${JSON.stringify(exampleParams)}'`;
    }
  }

  const schema: MethodSchema = {
    name: `${domainName}.${command.name}`,
    domain: domainName,
    method: command.name,
    parameters,
    returns,
    example,
  };

  if (command.description) schema.description = command.description;
  if (command.experimental) schema.experimental = command.experimental;
  if (command.deprecated) schema.deprecated = command.deprecated;

  return schema;
}

/**
 * Convert protocol parameter to schema.
 */
function paramToSchema(param: Parameter): ParameterSchema {
  const schema: ParameterSchema = {
    name: param.name,
    type: resolveType(param),
    required: !param.optional,
  };

  if (param.description) schema.description = param.description;
  if (param.deprecated) schema.deprecated = param.deprecated;
  if (param.enum) schema.enum = param.enum;
  if (param.items) schema.items = resolveType(param.items);

  return schema;
}

/**
 * Convert protocol return value to schema.
 */
function returnToSchema(ret: ReturnValue): ReturnSchema {
  const schema: ReturnSchema = {
    name: ret.name,
    type: resolveType(ret),
    optional: ret.optional ?? false,
  };

  if (ret.description) schema.description = ret.description;
  if (ret.items) schema.items = resolveType(ret.items);

  return schema;
}

/**
 * Resolve type from parameter/return value.
 *
 * @param typeRef - Type reference from protocol
 * @returns Type string (e.g., 'string', 'integer', 'Network.Cookie')
 */
function resolveType(typeRef: { type?: string; $ref?: string }): string {
  if (typeRef.$ref) {
    return typeRef.$ref;
  }
  return typeRef.type ?? 'any';
}

/**
 * Get example value for a parameter type.
 *
 * @param param - Parameter schema
 * @returns Example value
 */
function getExampleValue(param: ParameterSchema): unknown {
  if (param.enum && param.enum.length > 0) {
    return param.enum[0];
  }

  switch (param.type) {
    case 'string':
      return 'example';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

/**
 * Get all methods in a domain.
 *
 * @param domainName - Domain name (case-insensitive)
 * @returns Array of method schemas
 *
 * @example
 * ```typescript
 * const methods = getDomainMethods('Network');
 * console.log(methods.length); // 39
 * console.log(methods[0].name); // 'Network.getIPProtectionProxyStatus'
 * ```
 */
export function getDomainMethods(domainName: string): MethodSchema[] {
  const domain = findDomain(domainName);
  if (!domain?.commands) {
    return [];
  }

  return domain.commands.map((cmd) => buildMethodSchema(domain.domain, cmd));
}

/**
 * Get summary information for a domain.
 *
 * @param domainName - Domain name (case-insensitive)
 * @returns Domain summary or undefined if not found
 *
 * @example
 * ```typescript
 * const summary = getDomainSummary('Network');
 * console.log(summary.commandCount); // 39
 * console.log(summary.eventCount); // 12
 * ```
 */
export function getDomainSummary(domainName: string): DomainSummary | undefined {
  const domain = findDomain(domainName);
  if (!domain) {
    return undefined;
  }

  return buildDomainSummary(domain);
}

/**
 * Build domain summary from protocol domain.
 */
function buildDomainSummary(domain: Domain): DomainSummary {
  const summary: DomainSummary = {
    name: domain.domain,
    commandCount: domain.commands?.length ?? 0,
    eventCount: domain.events?.length ?? 0,
  };

  if (domain.description) summary.description = domain.description;
  if (domain.experimental) summary.experimental = domain.experimental;
  if (domain.deprecated) summary.deprecated = domain.deprecated;
  if (domain.dependencies) summary.dependencies = domain.dependencies;

  return summary;
}

/**
 * Get summaries for all domains.
 *
 * @returns Array of domain summaries
 *
 * @example
 * ```typescript
 * const summaries = getAllDomainSummaries();
 * console.log(summaries.length); // 53
 * console.log(summaries.find(d => d.name === 'Network').commandCount); // 39
 * ```
 */
export function getAllDomainSummaries(): DomainSummary[] {
  const protocol = loadProtocol();
  return protocol.domains.map(buildDomainSummary);
}

/**
 * Search methods by keyword (case-insensitive).
 *
 * Searches in method names and descriptions.
 *
 * @param query - Search query
 * @returns Array of matching method schemas
 *
 * @example
 * ```typescript
 * const cookies = searchMethods('cookie');
 * // Returns: Network.getCookies, Network.setCookie, Network.deleteCookies, etc.
 * ```
 */
export function searchMethods(query: string): MethodSchema[] {
  const protocol = loadProtocol();
  const results: MethodSchema[] = [];
  const lowerQuery = query.toLowerCase();

  protocol.domains.forEach((domain) => {
    if (!domain.commands) return;

    domain.commands.forEach((command) => {
      const nameMatch = command.name.toLowerCase().includes(lowerQuery);
      const descMatch = command.description?.toLowerCase().includes(lowerQuery) ?? false;

      if (nameMatch || descMatch) {
        results.push(buildMethodSchema(domain.domain, command));
      }
    });
  });

  return results;
}
