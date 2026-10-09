/**
 * What `bdg cdp <name>` calls: the bundled protocol follows Chromium's
 * tip of tree, so the user's Chrome can have methods it lacks (and lack
 * methods it has). A well-formed name is sent even when the schema does not
 * know it, unless it is a close typo of a method or domain the schema knows.
 */

import {
  findCommand,
  findDomain,
  findType,
  loadProtocol,
  normalizeMethod,
} from '@/cdp/protocol.js';
import { levenshteinDistance } from '@/utils/levenshtein.js';
import { findSimilar } from '@/utils/suggestions.js';

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
 * Methods (or events) of a domain close to the typed name.
 *
 * @param domainName - Domain with its schema casing
 * @param memberName - Method or event part as typed
 * @param members - `commands` for methods, `events` for events
 * @returns Full names of close methods or events
 */
function closeMembers(
  domainName: string,
  memberName: string,
  members: 'commands' | 'events' = 'commands'
): string[] {
  const entries = findDomain(domainName)?.[members] ?? [];
  const exact = entries.find((c) => c.name.toLowerCase() === memberName.toLowerCase());
  const names = exact
    ? [exact.name]
    : closeNames(
        memberName,
        entries.map((c) => c.name)
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
  return { kind: 'typo', method, suggestions: domains.flatMap((d) => closeMembers(d, methodName)) };
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
  const suggestions = closeMembers(domain.domain, methodName);
  return suggestions.length > 0
    ? { kind: 'typo', method, suggestions }
    : { kind: 'unlisted', method };
}

/** What an event name (`--collect`, `--until`, `--listen`, `--events`) resolves to */
export type CdpEventTarget =
  /** An event in the bundled protocol, with its casing */
  | { kind: 'known'; event: string }
  /** A well-formed event the bundled protocol lacks, listened to as typed (known domain recased) */
  | { kind: 'unlisted'; event: string }
  /** A close typo of bundled events (suggestions may be empty when only the domain is close) */
  | { kind: 'typo'; event: string; suggestions: string[] }
  /** A method of the bundled protocol, not an event */
  | { kind: 'method'; method: string }
  /** Not `Domain.event` */
  | { kind: 'malformed' };

/**
 * Decide which event `bdg cdp` listens to for a name: like methods, a
 * well-formed name the bundled protocol lacks is taken as typed (Chrome may
 * have newer events), unless it is a close typo of a bundled event or domain.
 *
 * @param input - Event name as typed (case-insensitive for bundled events)
 * @returns Known, unlisted, typo, method or malformed
 *
 * @example
 * ```typescript
 * resolveEventTarget('fetch.requestpaused'); // known Fetch.requestPaused
 * resolveEventTarget('Fetch.requestPausd');  // typo of Fetch.requestPaused
 * resolveEventTarget('Tracing.end');         // a method, not an event
 * ```
 */
export function resolveEventTarget(input: string): CdpEventTarget {
  if (!METHOD_NAME.test(input)) return { kind: 'malformed' };
  const [domainName = '', eventName = ''] = input.split('.');
  const domain = findDomain(domainName);
  if (!domain) {
    const domains = closeNames(
      domainName,
      loadProtocol().domains.map((d) => d.domain)
    );
    if (domains.length === 0) return { kind: 'unlisted', event: input };
    const suggestions = domains.flatMap((d) => closeMembers(d, eventName, 'events'));
    return { kind: 'typo', event: input, suggestions };
  }
  const event = domain.events?.find((e) => e.name.toLowerCase() === eventName.toLowerCase());
  if (event) return { kind: 'known', event: `${domain.domain}.${event.name}` };
  const command = findCommand(domain.domain, eventName);
  if (command) return { kind: 'method', method: `${domain.domain}.${command.name}` };
  const named = `${domain.domain}.${eventName}`;
  const suggestions = closeMembers(domain.domain, eventName, 'events');
  return suggestions.length > 0
    ? { kind: 'typo', event: named, suggestions }
    : { kind: 'unlisted', event: named };
}

/**
 * Why Chrome may have answered that it has no method bdg sent (-32601), as
 * far as the bundled protocol tells.
 */
export type MissingMethodCause =
  /** A bundled method: this Chrome is older than the bundled protocol (or the method is not for pages) */
  | { kind: 'older' }
  /** A bundled method redirected to a method the protocol lacks, with methods close to that one */
  | { kind: 'deadRedirect'; target: string; similar: string[] }
  /** A domain the bundled protocol lacks too, with bundled domains close to it */
  | { kind: 'unknownDomain'; domain: string; similar: string[] }
  /** A method of a bundled domain the bundled protocol lacks; `oneCase` when typed in one case */
  | { kind: 'unlisted'; oneCase: boolean };

/**
 * Names close to a name, for a "Did you mean" after Chrome refused it: up
 * to half its length off (at most 3), so `Foo` is not taken for `Log`.
 *
 * @param name - Name as sent
 * @param candidates - Known names
 * @returns Close names, closest first
 */
function similarNames(name: string, candidates: readonly string[]): string[] {
  return findSimilar(name, candidates, {
    maxDistance: Math.min(3, Math.max(1, Math.floor(name.length / 2))),
  });
}

/**
 * Whether a method name is all lower or all upper case, which a CDP method
 * of more than one word never is (they are lowerCamelCase).
 *
 * @param methodName - Method part as sent
 * @returns True for e.g. `getrelatedwebsitesets`
 */
function isOneCase(methodName: string): boolean {
  return methodName === methodName.toLowerCase() || methodName === methodName.toUpperCase();
}

/**
 * Why Chrome has no method bdg sent (it answered -32601): a bundled method
 * this Chrome is older than, one redirected to a method the protocol lacks,
 * a domain neither knows, or a method the bundled protocol lacks.
 *
 * @param method - Method as sent (`Domain.method`, a bundled domain recased)
 * @returns The cause
 *
 * @example
 * ```typescript
 * missingMethodCause('Page.deleteCookie'); // deadRedirect to Network.deleteCookie
 * missingMethodCause('Foo.bar');           // unknownDomain Foo
 * ```
 */
export function missingMethodCause(method: string): MissingMethodCause {
  const [domainName = '', methodName = ''] = method.split('.');
  const domain = findDomain(domainName);
  if (!domain) {
    const domains = loadProtocol().domains.map((d) => d.domain);
    return {
      kind: 'unknownDomain',
      domain: domainName,
      similar: similarNames(domainName, domains),
    };
  }
  const command = findCommand(domain.domain, methodName);
  if (!command) return { kind: 'unlisted', oneCase: isOneCase(methodName) };
  if (!command.redirect || findCommand(command.redirect, command.name)) return { kind: 'older' };
  const targetMethods = findDomain(command.redirect)?.commands?.map((c) => c.name) ?? [];
  return {
    kind: 'deadRedirect',
    target: `${command.redirect}.${command.name}`,
    similar: similarNames(command.name, targetMethods).map((name) => `${command.redirect}.${name}`),
  };
}
