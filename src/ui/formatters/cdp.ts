/**
 * Human-readable output of `bdg cdp`: search results, domain and method
 * lists, method schemas and method results (`--json` prints the data as is).
 */

import type { ParameterSchema, ReturnSchema } from '@/cdp/schema.js';
import { joinLines, pluralize } from '@/ui/formatting.js';

/** Protocol description and flags shared by domains and methods */
interface ProtocolEntry {
  description?: string | undefined;
  experimental?: boolean | undefined;
  deprecated?: boolean | undefined;
}

/** A method in `bdg cdp --search` results */
interface CdpSearchMethod extends ProtocolEntry {
  name: string;
  domain: string;
  method: string;
  parameterCount: number;
  example?: string | undefined;
}

/** `bdg cdp --search <query>` result */
export interface CdpSearchData {
  query: string;
  count: number;
  methods: CdpSearchMethod[];
}

/** A domain in `bdg cdp --list` */
interface CdpDomainEntry extends ProtocolEntry {
  name: string;
  commands: number;
  events: number;
  dependencies?: string[] | undefined;
}

/** `bdg cdp --list` result */
export interface CdpDomainListData {
  count: number;
  domains: CdpDomainEntry[];
}

/** A method in `bdg cdp <Domain> --list` */
interface CdpDomainMethod extends ProtocolEntry {
  name: string;
  fullName: string;
  parameterCount: number;
  parameters: Pick<ParameterSchema, 'name' | 'type' | 'required'>[];
  returns: Pick<ReturnSchema, 'name' | 'type'>[];
  example?: string | undefined;
}

/** `bdg cdp <Domain> --list` result */
export interface CdpDomainMethodsData {
  domain: string;
  description?: string | undefined;
  count: number;
  methods: CdpDomainMethod[];
}

/** `bdg cdp <Domain> --describe` result */
export interface CdpDomainDescription extends ProtocolEntry {
  type: 'domain';
  domain: string;
  commands: number;
  events: number;
  note?: string | undefined;
  nextStep: string;
}

/** A parameter or return value in `bdg cdp <Domain.method> --describe` */
interface CdpField {
  name: string;
  type: string;
  description?: string | undefined;
  items?: string | undefined;
}

/** `bdg cdp <Domain.method> --describe` result */
export interface CdpMethodDescription extends ProtocolEntry {
  type: 'method';
  name: string;
  domain: string;
  method: string;
  note?: string | undefined;
  parameters: (CdpField & {
    required: boolean;
    enum?: string[] | undefined;
    deprecated?: boolean | undefined;
  })[];
  returns: (CdpField & { optional: boolean })[];
  example?: { command: string; params?: Record<string, unknown> | undefined } | undefined;
}

/** `bdg cdp <Domain.method>` result */
export interface CdpExecuteData {
  method: string;
  result: unknown;
}

/**
 * First sentence (or line) of a protocol description.
 *
 * @param description - Description, possibly multi-line
 * @returns Its first sentence, or an empty string
 */
function firstSentence(description: string | undefined): string {
  const [line = ''] = (description ?? '').split('\n');
  const end = line.indexOf('. ');
  return end === -1 ? line : line.slice(0, end + 1);
}

/**
 * `(experimental, deprecated)` tags, or nothing.
 *
 * @param flags - Protocol flags
 * @returns Tag text with a leading space, or an empty string
 */
function tags(flags: ProtocolEntry): string {
  const names = [flags.experimental && 'experimental', flags.deprecated && 'deprecated'].filter(
    Boolean
  );
  return names.length > 0 ? ` (${names.join(', ')})` : '';
}

/**
 * Rows of a name column padded to one width, then the rest.
 *
 * @param rows - Name and text of each row
 * @returns Indented lines
 */
function columns(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([name]) => name.length));
  return rows.map(([name, text]) => `  ${name.padEnd(width)}  ${text.trim()}`.trimEnd());
}

/**
 * A type as written in the schema, e.g. "array<Cookie>".
 *
 * @param field - Parameter or return value
 * @returns Type text
 */
function typeText(field: CdpField): string {
  return field.items ? `${field.type}<${field.items}>` : field.type;
}

/**
 * Format `bdg cdp --search <query>`.
 *
 * @param data - Search result
 * @returns Matching methods with their first description sentence
 */
export function formatCdpSearch(data: CdpSearchData): string {
  if (data.count === 0) {
    return joinLines(`No CDP method matches "${data.query}"`, 'List the domains: bdg cdp --list');
  }
  return joinLines(
    `${pluralize(data.count, 'method')} ${data.count === 1 ? 'matches' : 'match'} "${data.query}":`,
    ...columns(data.methods.map((m) => [m.name, `${firstSentence(m.description)}${tags(m)}`])),
    'Parameters and an example: bdg cdp <Domain.method> --describe'
  );
}

/**
 * Format `bdg cdp --list`.
 *
 * @param data - All domains
 * @returns One line per domain with its method and event counts
 */
export function formatCdpDomains(data: CdpDomainListData): string {
  return joinLines(
    `${pluralize(data.count, 'CDP domain')}:`,
    ...columns(
      data.domains.map((d) => [
        d.name,
        `${pluralize(d.commands, 'method')}, ${pluralize(d.events, 'event')}${tags(d)}`,
      ])
    ),
    'Methods of a domain: bdg cdp <Domain> --list'
  );
}

/**
 * Format `bdg cdp <Domain> --list`.
 *
 * @param data - The domain's methods
 * @returns One line per method with the first sentence of its description
 */
export function formatCdpDomainMethods(data: CdpDomainMethodsData): string {
  return joinLines(
    `${data.domain}: ${pluralize(data.count, 'method')}`,
    firstSentence(data.description) || undefined,
    ...columns(data.methods.map((m) => [m.name, `${firstSentence(m.description)}${tags(m)}`])),
    `Parameters and an example: bdg cdp ${data.domain}.<method> --describe`
  );
}

/**
 * Lines of a parameter or return value list.
 *
 * @param title - Section title
 * @param fields - Parameters or return values
 * @returns Title and one line per field, or nothing for an empty list
 */
function fieldSection(title: string, fields: (CdpField & { optional: boolean })[]): string[] {
  if (fields.length === 0) return [];
  return [
    `${title}:`,
    ...columns(
      fields.map((f) => [
        `${f.name}${f.optional ? '?' : ''}: ${typeText(f)}`,
        (f.description ?? '').replace(/\s*\n\s*/g, ' '),
      ])
    ),
  ];
}

/**
 * Format `bdg cdp <Domain.method> --describe` or `bdg cdp <Domain> --describe`.
 *
 * @param data - Method or domain description
 * @returns Description, parameters (`?` = optional), returns, note and example
 */
export function formatCdpDescription(data: CdpMethodDescription | CdpDomainDescription): string {
  if (data.type === 'domain') {
    return joinLines(
      `${data.domain}: ${pluralize(data.commands, 'method')}, ${pluralize(data.events, 'event')}${tags(data)}`,
      data.description,
      data.note,
      data.nextStep
    );
  }
  return joinLines(
    `${data.name}${tags(data)}`,
    data.description,
    ...fieldSection(
      'Parameters',
      data.parameters.map((p) => ({ ...p, optional: !p.required }))
    ),
    ...fieldSection('Returns', data.returns),
    data.note && `Note: ${data.note}`,
    data.example && `Example: ${data.example.command}`
  );
}

/**
 * Whether a CDP method returned nothing (null, undefined or an empty object).
 *
 * @param result - Method result
 * @returns True for an empty result
 */
export function isEmptyCdpResult(result: unknown): boolean {
  return (
    result === null ||
    result === undefined ||
    (typeof result === 'object' && Object.keys(result).length === 0)
  );
}

/**
 * Format a CDP method's result: the result object as indented JSON.
 *
 * @param data - Method and its result
 * @returns The result, or a line saying the method returned nothing
 */
export function formatCdpResult(data: CdpExecuteData): string {
  return isEmptyCdpResult(data.result)
    ? `${data.method}: done (no result data)`
    : JSON.stringify(data.result, null, 2);
}
