/**
 * Machine-readable help and command groups (#698).
 *
 * A command group run with `--json` and no subcommand names the missing
 * subcommand and lists them; `--help --json` on an unknown command is the same
 * error as `<command> --json`; `command.options` is one array shape in every
 * help document. No session is started.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';

interface Envelope {
  success: boolean;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

interface OptionEntry {
  flags: string;
  description: string;
  required: boolean;
  takesValue: boolean;
}

interface HelpNode {
  name: string;
  options?: OptionEntry[];
  subcommands?: HelpNode[];
}

/**
 * Run bdg with `--json` and parse its single stdout document.
 *
 * @param args - Arguments (the first is the command or flag)
 * @returns Exit code and parsed JSON
 */
async function runJson<T>(args: string[]): Promise<{ exitCode: number | null; json: T }> {
  const [first = '', ...rest] = args;
  const result = await runCommand(first, rest, { timeout: 30000 });
  return { exitCode: result.exitCode, json: JSON.parse(result.stdout) as T };
}

/**
 * Every node of a compact command tree.
 *
 * @param node - Tree root
 * @returns The node and all its descendants
 */
function flatten(node: HelpNode): HelpNode[] {
  return [node, ...(node.subcommands ?? []).flatMap(flatten)];
}

void describe('command groups and machine-readable help (#698)', () => {
  void it('says a group needs a subcommand and lists them, for every group', async () => {
    for (const group of ['page', 'dom', 'network', 'state', 'css']) {
      const { exitCode, json } = await runJson<Envelope>([group, '--json']);
      assert.equal(exitCode, 81, group);
      assert.equal(json.success, false, group);
      assert.match(json.error ?? '', new RegExp(`^${group} needs a subcommand: \\w+(, [\\w-]+)*`));
      assert.doesNotMatch(json.error ?? '', /unknown option/, group);
      assert.match(json.suggestion ?? '', new RegExp(`^Run "bdg ${group} --help"`), group);
    }
    const page = await runJson<Envelope>(['page', '--json']);
    assert.match(page.json.error ?? '', /info, navigate/);
  });

  void it('keeps a mistyped subcommand and a mistyped option as they were', async () => {
    const sub = await runJson<Envelope>(['page', 'nosuch', '--json']);
    assert.match(sub.json.error ?? '', /unknown command 'nosuch'/);
    const opt = await runJson<Envelope>(['page', '--frobnicate', '--json']);
    assert.match(opt.json.error ?? '', /unknown option '--frobnicate'/);
  });

  void it('answers --help --json on an unknown command with the unknown-command error', async () => {
    const plain = await runJson<Envelope>(['nosuch', '--json']);
    for (const args of [
      ['nosuch', '--help', '--json'],
      ['--json', '--help', 'nosuch'],
    ]) {
      const { exitCode, json } = await runJson<Envelope>(args);
      assert.equal(exitCode, 81, args.join(' '));
      assert.equal(json.success, false, args.join(' '));
      assert.equal(json.error, plain.json.error, args.join(' '));
    }
    const typo = await runJson<Envelope>(['netwrk', '--help', '--json']);
    assert.equal(typo.exitCode, 81);
    assert.match(typo.json.suggestion ?? '', /Did you mean: bdg network/);
  });

  void it('answers --help --json on an unknown subcommand with an error', async () => {
    const { exitCode, json } = await runJson<Envelope>(['page', 'nosuch', '--help', '--json']);
    assert.equal(exitCode, 81);
    assert.equal(json.success, false);
    assert.match(json.error ?? '', /Unknown command: "page nosuch"/);
  });

  void it('still answers --help --json for known commands, options of other commands skipped', async () => {
    for (const args of [
      ['--help', '--json'],
      ['--session', 'a', '--help', '--json'],
      ['dom', '--help', '--json'],
      ['dom', 'query', '--limit', '5', '--help', '--json'],
      ['https://example.com', '--help', '--json'],
    ]) {
      const { exitCode } = await runJson<object>(args);
      assert.equal(exitCode, 0, args.join(' '));
    }
  });

  void it('lists options as one array shape in the root, the group and the command help', async () => {
    const root = await runJson<{ command: HelpNode }>(['--help', '--json']);
    const group = await runJson<{ command: HelpNode }>(['dom', '--help', '--json']);
    const leaf = await runJson<{ command: HelpNode }>(['dom', 'query', '--help', '--json']);
    for (const node of [
      ...flatten(root.json.command),
      ...flatten(group.json.command),
      ...flatten(leaf.json.command),
    ]) {
      if (node.options === undefined) continue;
      assert.ok(Array.isArray(node.options), `${node.name}: options is an array`);
      for (const option of node.options) {
        assert.equal(typeof option.flags, 'string', node.name);
        assert.equal(typeof option.description, 'string', node.name);
        assert.equal(typeof option.required, 'boolean', node.name);
        assert.equal(typeof option.takesValue, 'boolean', node.name);
      }
    }
    const rootOptions = root.json.command.options ?? [];
    assert.ok(Array.isArray(rootOptions) && rootOptions.length > 0, 'root options');
    const port = rootOptions.find((o) => o.flags === '-p, --port <number>');
    assert.equal(port?.takesValue, true);
    const status = root.json.command.subcommands?.find((c) => c.name === 'status');
    assert.ok(Array.isArray(status?.options), 'root subcommand options');
  });
});
