/**
 * `BDG_ATTACH_REQUIRE_WS_URL` smoke test (#878): a test-only variable that
 * stops `bdg attach` from reading Chrome's default profile, which is the
 * owner's everyday Chrome. A temporary HOME holds a valid-looking
 * `DevToolsActivePort` at the default profile path of this platform; with the
 * variable set, attach (list and tab) exits 81 and says so, never reading
 * that file or contacting its port. Without it, the same setup reads the file
 * (control: exit 101 or 83 naming it), and `--chrome-ws-url` is not refused.
 * No Chrome is started.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { defaultChromeUserDataDir } from '@/connection/devToolsActivePort.js';

interface Envelope {
  success: boolean;
  error?: string;
  exitCode?: number;
  suggestion?: string;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-require-ws-'));
const home = path.join(root, 'home');
const sessionDir = path.join(root, 'session');
const profileEnv = {
  HOME: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  CHROME_CONFIG_HOME: '',
};
const portFile = path.join(
  defaultChromeUserDataDir({ platform: process.platform, home, env: profileEnv }),
  'DevToolsActivePort'
);

/**
 * Run `bdg attach` with the temporary profile lookup.
 *
 * @param args - Arguments
 * @param guard - Value of the variable (undefined: unset)
 * @returns Exit code, parsed envelope and raw output
 */
async function attach(
  args: string[],
  guard?: string
): Promise<{ exitCode: number; envelope: Envelope; output: string }> {
  const result = await runCommand('attach', [...args, '--json'], {
    timeout: 30000,
    env: { ...profileEnv, BDG_SESSION_DIR: sessionDir, BDG_ATTACH_REQUIRE_WS_URL: guard ?? '' },
  });
  return {
    exitCode: result.exitCode,
    envelope: JSON.parse(result.stdout || '{}') as Envelope,
    output: result.stdout + result.stderr,
  };
}

void describe('BDG_ATTACH_REQUIRE_WS_URL (#878)', () => {
  let port: number;

  before(async () => {
    port = await getFreePort();
    fs.mkdirSync(path.dirname(portFile), { recursive: true });
    fs.writeFileSync(portFile, `${port}\n/devtools/browser/0123-abcd\n`);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  void it('without the variable attach reads the profile file (control)', async () => {
    const result = await attach([]);
    assert.notEqual(result.exitCode, 81, result.output);
    assert.ok(result.output.includes(portFile), result.output);
  });

  for (const args of [[], ['some-tab']]) {
    void it(`exits 81 before reading the profile file: attach ${args.join(' ')}`, async () => {
      const result = await attach(args, '1');
      assert.equal(result.exitCode, 81, result.output);
      assert.equal(result.envelope.success, false);
      assert.equal(result.envelope.exitCode, 81);
      assert.match(result.envelope.error ?? '', /BDG_ATTACH_REQUIRE_WS_URL is set/);
      assert.match(result.envelope.suggestion ?? '', /--chrome-ws-url/);
      assert.ok(!result.output.includes(portFile), result.output);
    });
  }

  void it('a mistyped value keeps the guard on', async () => {
    const result = await attach([], 'yes please');
    assert.equal(result.exitCode, 81, result.output);
  });

  void it('0 leaves the guard off', async () => {
    const result = await attach([], '0');
    assert.notEqual(result.exitCode, 81, result.output);
  });

  void it('--chrome-ws-url is not refused', async () => {
    const result = await attach(['--chrome-ws-url', String(await getFreePort())], '1');
    assert.notEqual(result.exitCode, 81, result.output);
    assert.ok(!/BDG_ATTACH_REQUIRE_WS_URL/.test(result.output), result.output);
  });
});
