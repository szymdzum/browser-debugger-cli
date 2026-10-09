/**
 * CDP Schema Introspection
 *
 * Provides structured, agent-friendly schema information for all CDP domains and methods.
 * Follows principles from docs/AGENT_FRIENDLY_TOOLS.md:
 * - Machine-readable output (JSON schema)
 * - Self-describing tools
 * - Structured context without verbosity
 */

import type { Domain, Command, Parameter, ReturnValue, Type } from './types.js';

import { loadProtocol, findDomain, findCommand, findType } from './protocol.js';

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
  /**
   * The method implementing this one (the schema's `redirect`) and its
   * parameters; `resolved` is false when the protocol lacks that method
   * (e.g. Page.deleteCookie names Network.deleteCookie)
   */
  redirect?: {
    method: string;
    resolved: boolean;
    parameters: ParameterSchema[];
  };
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
  /** Enum values (inline, or of the referenced type) */
  enum?: string[];
  /** Referenced protocol type with its domain (e.g. 'Network.CookieSameSite'), for `--describe` */
  ref?: string;
  /** Base type of the referenced type (e.g. 'number' for Network.TimeSinceEpoch, 'object') */
  refType?: string;
  /** Array item type (if type is array) */
  items?: string;
  /** Deprecated flag */
  deprecated?: boolean;
  /** Experimental flag */
  experimental?: boolean;
}

/**
 * Protocol type (`Network.CookieSameSite`, `Network.Cookie`) for agent consumption.
 */
export interface TypeSchema {
  /** Full type name (Domain.Type) */
  name: string;
  /** Domain name */
  domain: string;
  /** Type id */
  id: string;
  /** Base type (string, object, array, ...) */
  baseType: string;
  /** Human-readable description */
  description?: string;
  /** Whether type is experimental */
  experimental?: boolean;
  /** Whether type is deprecated */
  deprecated?: boolean;
  /** Enum values (string enums) */
  enum?: string[];
  /** Array item type */
  items?: string;
  /** Properties (object types) */
  properties?: ParameterSchema[];
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
  const parameters = command.parameters?.map((p) => paramToSchema(domainName, p)) ?? [];
  const returns = command.returns?.map(returnToSchema) ?? [];
  const redirect = buildRedirect(command);
  const exampleSource = parameters.length > 0 ? parameters : (redirect?.parameters ?? []);

  const schema: MethodSchema = {
    name: `${domainName}.${command.name}`,
    domain: domainName,
    method: command.name,
    parameters,
    returns,
    example: buildExample(`${domainName}.${command.name}`, exampleSource),
  };

  if (redirect) schema.redirect = redirect;
  if (command.description) schema.description = command.description;
  if (command.experimental) schema.experimental = command.experimental;
  if (command.deprecated) schema.deprecated = command.deprecated;

  return schema;
}

/**
 * The method a redirected command runs (e.g. DOM.highlightNode runs
 * Overlay.highlightNode), with the parameters Chrome checks, and whether the
 * protocol has that method.
 *
 * @param command - Command from protocol
 * @returns Redirect target, or undefined when the command has none
 */
function buildRedirect(command: Command): MethodSchema['redirect'] {
  if (!command.redirect) return undefined;
  const target = findCommand(command.redirect, command.name);
  return {
    method: `${command.redirect}.${command.name}`,
    resolved: target !== undefined,
    parameters: target?.parameters?.map((p) => paramToSchema(command.redirect ?? '', p)) ?? [],
  };
}

/**
 * Example command with the required parameters.
 *
 * @param methodName - Full method name
 * @param parameters - Parameters to take the required ones from
 * @returns Example command and its parameters
 */
function buildExample(
  methodName: string,
  parameters: ParameterSchema[]
): NonNullable<MethodSchema['example']> {
  const example: NonNullable<MethodSchema['example']> = { command: `bdg cdp ${methodName}` };
  const required = parameters.filter((p) => p.required);
  if (required.length === 0) return example;
  const exampleParams = Object.fromEntries(required.map((p) => [p.name, getExampleValue(p)]));
  example.params = exampleParams;
  example.command += ` --params '${JSON.stringify(exampleParams)}'`;
  return example;
}

/**
 * A protocol type a `$ref` names, resolved against the domain it is used in.
 *
 * @param domainName - Domain of the parameter (for refs without a domain)
 * @param ref - `$ref` value, e.g. 'CookieSameSite' or 'Runtime.RemoteObject'
 * @returns Full type name and definition, or undefined when the schema lacks it
 */
function lookupRef(domainName: string, ref: string): { name: string; type: Type } | undefined {
  const [refDomain, id] = ref.includes('.') ? ref.split('.') : [domainName, ref];
  const type = refDomain && id ? findType(refDomain, id) : undefined;
  return type && { name: `${refDomain}.${type.id}`, type };
}

/**
 * Convert protocol parameter (or object property) to schema; a `$ref` gets its
 * full type name and, for an enum type, its values.
 *
 * @param domainName - Domain the parameter belongs to
 * @param param - Protocol parameter
 * @returns Parameter schema
 */
function paramToSchema(domainName: string, param: Parameter): ParameterSchema {
  const schema: ParameterSchema = {
    name: param.name,
    type: resolveType(param),
    required: !param.optional,
  };
  const referenced = param.$ref ? lookupRef(domainName, param.$ref) : undefined;
  const values = param.enum ?? referenced?.type.enum;

  if (param.description) schema.description = param.description;
  if (param.deprecated) schema.deprecated = param.deprecated;
  if (param.experimental) schema.experimental = param.experimental;
  if (values) schema.enum = values;
  if (referenced) {
    schema.ref = referenced.name;
    schema.refType = referenced.type.type;
  }
  if (param.items) schema.items = resolveType(param.items);

  return schema;
}

/**
 * Get structured schema for a protocol type.
 *
 * @param domainName - Domain name (case-insensitive)
 * @param typeName - Type id (case-insensitive)
 * @returns Type schema or undefined if not found
 *
 * @example
 * ```typescript
 * getTypeSchema('Network', 'CookieSameSite')?.enum; // ['Strict', 'Lax', 'None']
 * ```
 */
export function getTypeSchema(domainName: string, typeName: string): TypeSchema | undefined {
  const domain = findDomain(domainName);
  const type = domain && findType(domain.domain, typeName);
  if (!domain || !type) return undefined;

  const schema: TypeSchema = {
    name: `${domain.domain}.${type.id}`,
    domain: domain.domain,
    id: type.id,
    baseType: type.type,
  };
  if (type.description) schema.description = type.description;
  if (type.experimental) schema.experimental = type.experimental;
  if (type.deprecated) schema.deprecated = type.deprecated;
  if (type.enum) schema.enum = type.enum;
  if (type.items) schema.items = resolveType(type.items);
  if (type.properties) {
    schema.properties = type.properties.map((p) => paramToSchema(domain.domain, p));
  }
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
 * Example values for parameters whose name says what a realistic value is,
 * where the type's placeholder would do something else (`width: 0` disables
 * `Emulation.setDeviceMetricsOverride`, `url: "example"` is no URL).
 */
const EXAMPLE_VALUES: Record<string, number | string> = {
  width: 1280,
  height: 800,
  x: 100,
  y: 100,
  deviceScaleFactor: 1,
  scale: 1,
  timeout: 5000,
  responseCode: 200,
  url: 'https://example.com',
};

/**
 * Get example value for a parameter: a realistic value for its name, else
 * one for its type (1 for numbers, so it never means "off").
 *
 * @param param - Parameter schema
 * @returns Example value
 */
function getExampleValue(param: ParameterSchema): unknown {
  if (param.enum && param.enum.length > 0) {
    return param.enum[0];
  }
  const type = param.refType ?? param.type;
  const named = Object.hasOwn(EXAMPLE_VALUES, param.name) ? EXAMPLE_VALUES[param.name] : undefined;
  const namedType = typeof named === 'number' ? ['integer', 'number'] : ['string'];
  if (named !== undefined && namedType.includes(type)) return named;
  switch (type) {
    case 'string':
      return 'example';
    case 'integer':
    case 'number':
      return 1;
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
 * Domain and method counts of the bundled protocol (for help text).
 *
 * @returns Number of domains, of methods overall, and of methods per domain
 */
export function getProtocolCounts(): {
  domains: number;
  methods: number;
  methodsIn: (domain: string) => number;
} {
  const summaries = getAllDomainSummaries();
  return {
    domains: summaries.length,
    methods: summaries.reduce((total, domain) => total + domain.commandCount, 0),
    methodsIn: (domain) => summaries.find((d) => d.name === domain)?.commandCount ?? 0,
  };
}

/**
 * Words agents search for that a method's name and description lack, e.g.
 * "viewport" for `Emulation.setDeviceMetricsOverride`.
 */
const SEARCH_KEYWORDS: Record<string, string[]> = {
  'Emulation.setDeviceMetricsOverride': [
    'viewport',
    'window size',
    'screen size',
    'resize',
    'responsive',
    'mobile',
  ],
  'Emulation.setEmulatedMedia': [
    'color scheme',
    'dark mode',
    'light mode',
    'prefers-color-scheme',
    'reduced motion',
    'print',
  ],
  'Browser.setWindowBounds': ['window size', 'resize'],
};

/**
 * Lower-case text without spaces, hyphens and underscores, so "user agent"
 * finds `setUserAgentOverride`.
 *
 * @param text - Text
 * @returns Normalized text
 */
function searchable(text: string): string {
  return text.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Search methods by keyword (case-insensitive).
 *
 * Searches method names, extra keywords ({@link SEARCH_KEYWORDS}) and
 * descriptions. Matches by name or keyword come first, then those found only
 * in the description, each in protocol order.
 *
 * @param query - Search query
 * @returns Array of matching method schemas
 *
 * @example
 * ```typescript
 * const cookies = searchMethods('cookie');
 * // Returns: Network.getCookies, Network.setCookie, Network.deleteCookies, etc.
 * searchMethods('viewport')[0]?.name; // 'Emulation.setDeviceMetricsOverride'
 * ```
 */
export function searchMethods(query: string): MethodSchema[] {
  const protocol = loadProtocol();
  const named: MethodSchema[] = [];
  const described: MethodSchema[] = [];
  const lowerQuery = query.toLowerCase();
  const needle = searchable(query);

  protocol.domains.forEach((domain) => {
    if (!domain.commands) return;

    domain.commands.forEach((command) => {
      const keywords = SEARCH_KEYWORDS[`${domain.domain}.${command.name}`] ?? [];
      const nameMatch =
        searchable(command.name).includes(needle) ||
        keywords.some((keyword) => searchable(keyword).includes(needle));
      const descMatch = command.description?.toLowerCase().includes(lowerQuery) ?? false;

      if (nameMatch) named.push(buildMethodSchema(domain.domain, command));
      else if (descMatch) described.push(buildMethodSchema(domain.domain, command));
    });
  });

  return [...named, ...described];
}
