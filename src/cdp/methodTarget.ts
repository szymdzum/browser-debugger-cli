/**
 * What `bdg cdp <name>` calls: the bundled protocol follows Chromium's
 * tip of tree, so the user's Chrome can have methods it lacks (and lack
 * methods it has). A well-formed name is sent even when the schema does not
 * know it, unless it is a close typo of a method or domain the schema knows.
 */

import { findDomain, findType, loadProtocol, normalizeMethod } from '@/cdp/protocol.js';
import { levenshteinDistance } from '@/utils/levenshtein.js';

/** What a `Domain.method` name resolves to */
export type MethodTarget =
  /** A method in the bundled protocol, with its casing */
  | { kind: 'known'; method: string }
  /** A well-formed method the bundled protocol lacks, sent as typed (known domain recased) */
  | { kind: 'unlisted'; method: string }
  /**
   * A close typo of bundled methods (suggestions may be empty when only the
   * domain is close), with the method to send if the user insists
   */
  | { kind: 'typo'; method: string; suggestions: string[] }
  /** A protocol type, not a method */
  | { kind: 'type'; name: string }
  /** Not `Domain.method` */
  | { kind: 'malformed' };

/** `Domain.method`: letters and digits, starting with a letter */
const METHOD_NAME = /^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/;

/**
 * Most edits a name can be off a known one and still count as its typo: 1
 * for names of up to 5 letters (so `Foo` is not taken for `Log`), else 2.
 *
 * @param name - Name as typed
 * @returns Edit distance limit
 */
function typoLimit(name: string): number {
  return name.length <= 5 ? 1 : 2;
}

/**
 * Names close enough to count as typos of the input, closest first.
 *
 * @param input - Name as typed
 * @param candidates - Known names
 * @returns Close candidates
 */
function closeNames(input: string, candidates: readonly string[]): string[] {
  const lower = input.toLowerCase();
  return candidates
    .map((name) => ({ name, distance: levenshteinDistance(lower, name.toLowerCase()) }))
    .filter(({ distance }) => distance > 0 && distance <= typoLimit(input))
    .sort((a, b) => a.distance - b.distance)
    .map(({ name }) => name);
}

/**
 * Methods of a domain close to the typed method name.
 *
 * @param domainName - Domain with its schema casing
 * @param methodName - Method part as typed
 * @returns Full names of close methods
 */
function closeMethods(domainName: string, methodName: string): string[] {
  const commands = findDomain(domainName)?.commands ?? [];
  const exact = commands.find((c) => c.name.toLowerCase() === methodName.toLowerCase());
  const names = exact
    ? [exact.name]
    : closeNames(
        methodName,
        commands.map((c) => c.name)
      );
  return names.map((name) => `${domainName}.${name}`);
}

/**
 * Resolve a domain the schema does not know: a typo of a known domain, or a
 * domain to send as is.
 *
 * @param domainName - Domain part as typed
 * @param methodName - Method part as typed
 * @returns Typo with suggested methods, or an unlisted method
 */
function resolveUnknownDomain(domainName: string, methodName: string): MethodTarget {
  const domains = closeNames(
    domainName,
    loadProtocol().domains.map((d) => d.domain)
  );
  const method = `${domainName}.${methodName}`;
  if (domains.length === 0) return { kind: 'unlisted', method };
  return { kind: 'typo', method, suggestions: domains.flatMap((d) => closeMethods(d, methodName)) };
}

/**
 * Decide what `bdg cdp <name>` calls.
 *
 * @param input - Method name as typed (case-insensitive for bundled methods)
 * @returns Known, unlisted, typo, type or malformed
 *
 * @example
 * ```typescript
 * resolveMethodTarget('network.getcookies');            // known Network.getCookies
 * resolveMethodTarget('Storage.getRelatedWebsiteSets'); // unlisted: sent as is
 * resolveMethodTarget('Network.getCookes');             // typo of Network.getCookies
 * ```
 */
export function resolveMethodTarget(input: string): MethodTarget {
  if (!METHOD_NAME.test(input)) return { kind: 'malformed' };
  const known = normalizeMethod(input);
  if (known) return { kind: 'known', method: known };

  const [domainName = '', methodName = ''] = input.split('.');
  const domain = findDomain(domainName);
  if (!domain) return resolveUnknownDomain(domainName, methodName);

  const type = findType(domain.domain, methodName);
  if (type) return { kind: 'type', name: `${domain.domain}.${type.id}` };
  const method = `${domain.domain}.${methodName}`;
  const suggestions = closeMethods(domain.domain, methodName);
  return suggestions.length > 0
    ? { kind: 'typo', method, suggestions }
    : { kind: 'unlisted', method };
}
