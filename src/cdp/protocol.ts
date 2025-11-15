/**
 * CDP Protocol Schema Loader
 *
 * Loads and parses the Chrome DevTools Protocol schema from the bundled
 * devtools-protocol package. Provides utilities for domain/method lookup
 * and introspection.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import type { ProtocolSchema, Domain, Command } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cache the protocol to avoid re-reading the file
let cachedProtocol: ProtocolSchema | null = null;

/**
 * Load the CDP protocol schema.
 *
 * Merges browser_protocol.json and js_protocol.json from devtools-protocol package.
 * The browser protocol contains domains like Network, Page, DOM, etc.
 * The JS protocol contains Runtime, Debugger, Console, Profiler, etc.
 * The merged protocol is cached after first load for performance.
 *
 * @returns CDP protocol schema with all domains, commands, and types
 *
 * @example
 * ```typescript
 * const protocol = loadProtocol();
 * console.log(`Protocol version: ${protocol.version.major}.${protocol.version.minor}`);
 * console.log(`Domains: ${protocol.domains.length}`); // ~53 domains (47 browser + 6 JS)
 * ```
 */
export function loadProtocol(): ProtocolSchema {
  if (cachedProtocol) {
    return cachedProtocol;
  }

  // Find the protocol files in node_modules
  // When compiled, __dirname is dist/cdp, so go up to project root
  const browserProtocolPath = join(
    __dirname,
    '../../node_modules/devtools-protocol/json/browser_protocol.json'
  );
  const jsProtocolPath = join(
    __dirname,
    '../../node_modules/devtools-protocol/json/js_protocol.json'
  );

  const browserProtocol = JSON.parse(readFileSync(browserProtocolPath, 'utf-8')) as ProtocolSchema;
  const jsProtocol = JSON.parse(readFileSync(jsProtocolPath, 'utf-8')) as ProtocolSchema;

  // Merge the two protocols
  // Use browser protocol as base, add JS protocol domains
  cachedProtocol = {
    version: browserProtocol.version,
    domains: [...browserProtocol.domains, ...jsProtocol.domains],
  };

  return cachedProtocol;
}

/**
 * Find a domain by name (case-insensitive).
 *
 * @param domainName - Domain name to find (e.g., 'network', 'Network', 'NETWORK')
 * @returns Domain object or undefined if not found
 *
 * @example
 * ```typescript
 * const domain = findDomain('network');  // Case-insensitive
 * console.log(domain?.domain); // 'Network'
 * console.log(domain?.commands.length); // 39
 * ```
 */
export function findDomain(domainName: string): Domain | undefined {
  const protocol = loadProtocol();
  const normalized = domainName.toLowerCase();
  return protocol.domains.find((d) => d.domain.toLowerCase() === normalized);
}

/**
 * Find a command within a domain (case-insensitive).
 *
 * @param domainName - Domain name (e.g., 'Network')
 * @param commandName - Command name (e.g., 'getCookies', 'GETCOOKIES')
 * @returns Command object or undefined if not found
 *
 * @example
 * ```typescript
 * const cmd = findCommand('Network', 'getcookies');  // Case-insensitive
 * console.log(cmd?.name); // 'getCookies'
 * console.log(cmd?.parameters); // [...]
 * ```
 */
export function findCommand(domainName: string, commandName: string): Command | undefined {
  const domain = findDomain(domainName);
  if (!domain?.commands) {
    return undefined;
  }

  const normalized = commandName.toLowerCase();
  return domain.commands.find((c) => c.name.toLowerCase() === normalized);
}

/**
 * Normalize a CDP method name to proper casing.
 *
 * Converts user input (any case) to CDP's actual method name.
 *
 * @param input - Method name in any format (e.g., 'network.getcookies', 'Runtime.Evaluate')
 * @returns Normalized method name (e.g., 'Network.getCookies') or undefined if not found
 *
 * @example
 * ```typescript
 * normalizeMethod('network.getcookies') // 'Network.getCookies'
 * normalizeMethod('runtime.evaluate')   // 'Runtime.evaluate'
 * normalizeMethod('NETWORK.GETCOOKIES') // 'Network.getCookies'
 * normalizeMethod('invalid.method')     // undefined
 * ```
 */
export function normalizeMethod(input: string): string | undefined {
  const [domainName, commandName] = input.split('.');
  if (!domainName || !commandName) {
    return undefined;
  }

  const domain = findDomain(domainName);
  if (!domain) {
    return undefined;
  }

  const command = findCommand(domain.domain, commandName);
  if (!command) {
    return undefined;
  }

  return `${domain.domain}.${command.name}`;
}
