#!/usr/bin/env node
/**
 * Moves the changelog fragments in `changes/` into CHANGELOG.md.
 *
 * Each PR adds one fragment, `changes/<slug>.md`: front matter naming the
 * section, then the entry as it should appear in the changelog (one or more
 * list items). See changes/README.md.
 *
 * Usage:
 *   node scripts/changelog-assemble.mjs                    entries go under ## [Unreleased]
 *   node scripts/changelog-assemble.mjs --version 0.17.0   ## [Unreleased] becomes ## [0.17.0] - <today>
 *       [--date YYYY-MM-DD]                                (a new, empty ## [Unreleased] stays above it)
 *   node scripts/changelog-assemble.mjs --check            validate the fragments only (CI)
 *
 * Fragments are taken in file name order; within a section they follow the
 * entries already under ## [Unreleased]. Sections are written in SECTIONS
 * order. The assembled fragments are deleted.
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Changelog sections, in the order they are written */
const SECTIONS = ['Breaking', 'Added', 'Changed', 'Fixed', 'Security', 'Internal'];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGES_DIR = join(ROOT, 'changes');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const UNRELEASED = '## [Unreleased]';
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

/**
 * Parse command line options.
 *
 * @param {string[]} args - Arguments after the script name
 * @returns {{ check: boolean, version?: string, date: string }} Options
 */
function parseArgs(args) {
  const options = { check: false, date: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--version') options.version = args[++i];
    else if (arg === '--date') options.date = args[++i];
    else fail([`Unknown argument: ${arg}`]);
  }
  if (options.version !== undefined && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(options.version)) {
    fail([`--version needs a version like 0.17.0, got: ${options.version}`]);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date ?? '')) fail(['--date needs YYYY-MM-DD']);
  return options;
}

/**
 * Print errors and exit 1.
 *
 * @param {string[]} errors - Messages
 */
function fail(errors) {
  for (const error of errors) console.error(`changelog: ${error}`);
  process.exit(1);
}

/**
 * Fragment file names, sorted (README.md is not a fragment).
 *
 * @returns {string[]} File names in `changes/`
 */
function fragmentFiles() {
  if (!existsSync(CHANGES_DIR)) return [];
  return readdirSync(CHANGES_DIR)
    .filter((file) => file.endsWith('.md') && file !== 'README.md')
    .sort();
}

/**
 * Read and validate one fragment.
 *
 * @param {string} file - File name in `changes/`
 * @returns {{ file: string, section?: string, body?: string, errors: string[] }} Fragment
 */
function readFragment(file) {
  const text = readFileSync(join(CHANGES_DIR, file), 'utf8').replace(/\r\n/g, '\n');
  const match = FRONT_MATTER.exec(text);
  if (!match)
    return { file, errors: [`${file}: must start with front matter (---, section: <name>, ---)`] };
  const fields = Object.fromEntries(
    match[1]
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        const colon = line.indexOf(':');
        return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
      })
  );
  const section = fields.section;
  const body = match[2].trim();
  const errors = [];
  const unknown = Object.keys(fields).filter((key) => key !== 'section');
  if (unknown.length > 0)
    errors.push(`${file}: unknown front matter field(s): ${unknown.join(', ')}`);
  if (!SECTIONS.includes(section)) {
    const near = SECTIONS.find((name) => name.toLowerCase() === String(section).toLowerCase());
    const hint = near ? `did you mean ${near}?` : `use one of ${SECTIONS.join(', ')}`;
    errors.push(`${file}: section "${section ?? ''}" is not a changelog section; ${hint}`);
  }
  if (body === '') errors.push(`${file}: the entry is empty`);
  else if (!body.startsWith('- '))
    errors.push(`${file}: the entry must be a list item ("- **Title** (#N): ...")`);
  return { file, section, body, errors };
}

/**
 * Split the `## [Unreleased]` block of the changelog into its sections.
 *
 * @param {string} changelog - CHANGELOG.md text
 * @returns {{ before: string, preamble: string[], sections: Map<string, string[]>, after: string }} Parts
 */
function splitUnreleased(changelog) {
  const start = changelog.indexOf(`${UNRELEASED}\n`);
  if (start === -1) fail([`CHANGELOG.md has no "${UNRELEASED}" heading`]);
  const bodyStart = start + UNRELEASED.length + 1;
  const nextRelease = changelog.indexOf('\n## ', bodyStart);
  const end = nextRelease === -1 ? changelog.length : nextRelease + 1;
  const sections = new Map();
  const preamble = [];
  let current = preamble;
  for (const line of changelog.slice(bodyStart, end).split('\n')) {
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      current = sections.get(heading[1]) ?? [];
      sections.set(heading[1], current);
    } else current.push(line);
  }
  return { before: changelog.slice(0, start), preamble, sections, after: changelog.slice(end) };
}

/**
 * Write sections in SECTIONS order (unknown ones after them, as found).
 *
 * @param {string[]} preamble - Lines before the first section
 * @param {Map<string, string[]>} sections - Lines by section name
 * @returns {string} Markdown, ending with a blank line
 */
function renderSections(preamble, sections) {
  const names = [...SECTIONS, ...[...sections.keys()].filter((name) => !SECTIONS.includes(name))];
  const blocks = [];
  const intro = preamble.join('\n').trim();
  if (intro !== '') blocks.push(intro);
  for (const name of names) {
    const body = (sections.get(name) ?? []).join('\n').trim();
    if (body !== '') blocks.push(`### ${name}\n\n${body}`);
  }
  return blocks.map((block) => `${block}\n\n`).join('');
}

/**
 * Merge the fragments into CHANGELOG.md and delete them.
 *
 * @param {{ file: string, section: string, body: string }[]} fragments - Valid fragments, sorted
 * @param {{ version?: string, date: string }} options - Target heading
 */
function assemble(fragments, options) {
  const { before, preamble, sections, after } = splitUnreleased(readFileSync(CHANGELOG, 'utf8'));
  for (const { section, body } of fragments) {
    const lines = sections.get(section) ?? [];
    sections.set(section, [...lines.join('\n').trimEnd().split('\n'), body]);
  }
  const content = renderSections(preamble, sections);
  const heading = options.version ? `## [${options.version}] - ${options.date}` : UNRELEASED;
  const released = options.version ? `${UNRELEASED}\n\n` : '';
  writeFileSync(CHANGELOG, `${before}${released}${heading}\n\n${content}${after}`);
  for (const { file } of fragments) unlinkSync(join(CHANGES_DIR, file));
  console.log(`changelog: ${fragments.length} fragment(s) moved under ${heading}`);
}

const options = parseArgs(process.argv.slice(2));
const fragments = fragmentFiles().map(readFragment);
const errors = fragments.flatMap((fragment) => fragment.errors);
if (errors.length > 0) fail(errors);
if (options.check) {
  splitUnreleased(readFileSync(CHANGELOG, 'utf8'));
  console.log(`changelog: ${fragments.length} fragment(s) valid`);
} else {
  assemble(fragments, options);
}
