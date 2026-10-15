import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests');

/** Paths of the files under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );
}

void describe('shell suites', () => {
  void it('load no page from the outside network', () => {
    const offenders = ['integration', 'error-scenarios', 'edge-cases']
      .flatMap((suite) => filesUnder(path.join(TESTS_DIR, suite)))
      .filter((file) => file.endsWith('.sh') && /example\.com/.test(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(offenders, []);
  });

  void it('are run against the fixture server and keep their session dirs on failure', () => {
    const runner = fs.readFileSync(path.join(TESTS_DIR, 'run-all-tests.sh'), 'utf8');
    assert.match(runner, /serveFixtures/);
    assert.match(runner, /BDG_FIXTURE_URL/);
    assert.match(runner, /session dir kept/i);
  });
});
