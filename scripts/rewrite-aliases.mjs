#!/usr/bin/env node
/**
 * Rewrites `@/` path aliases in compiled output to relative specifiers.
 *
 * Replaces tsc-alias (whose chokidar/globby dependency chain pulls in a
 * vulnerable, unpatched `braces`). Mirrors its output: `@/a/b.js` becomes
 * `../a/b.js`, and extensionless `@/types` resolves to `../types.js` or
 * `../types/index.js` depending on what exists in dist.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');
const ALIAS_PATTERN = /((?:from|import)\s*\(?\s*)(['"])@\/([^'"]+)\2/g;

/**
 * Resolves an alias target to a dist-relative path with a `.js` extension.
 *
 * @param target - Specifier without the `@/` prefix
 * @returns Path relative to dist
 */
function resolveTarget(target) {
  if (/\.(?:m?js|json)$/.test(target)) return target;
  const asDirectory = join(DIST, target);
  if (existsSync(asDirectory) && statSync(asDirectory).isDirectory()) return `${target}/index.js`;
  return `${target}.js`;
}

/**
 * Rewrites all alias specifiers in a single file, writing only when changed.
 *
 * @param file - Absolute path to a compiled file
 */
function rewriteFile(file) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(ALIAS_PATTERN, (_match, prefix, quote, target) => {
    let specifier = relative(dirname(file), join(DIST, resolveTarget(target)));
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    return `${prefix}${quote}${specifier}${quote}`;
  });
  if (rewritten !== source) writeFileSync(file, rewritten);
}

for (const entry of readdirSync(DIST, { recursive: true })) {
  if (/\.(?:js|d\.ts)$/.test(entry)) rewriteFile(join(DIST, entry));
}
