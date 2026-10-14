/**
 * The source a `bdg dom eval` script runs as (#743): a block that keeps a
 * strict directive and a hashbang working, the script's own syntax errors,
 * and positions mapped back to the script.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evalLine, withEvalPositions, wrapEvalScript } from '@/runtime/dom/evalSource.js';

void describe('wrapEvalScript()', () => {
  void it('wraps a script in a block named bdg-eval', () => {
    assert.equal(wrapEvalScript('const t = 1; t'), '{\nconst t = 1; t\n}\n//# sourceURL=bdg-eval');
  });

  void it('keeps a strict directive after comments and whitespace', () => {
    for (const script of [
      '"use strict"; x = 1',
      "  'use strict'\nx = 1",
      '// hi\n"use strict"; x = 1',
      '/* c */ "use strict"; x = 1',
      '"other"; "use strict"; x = 1',
    ]) {
      assert.match(wrapEvalScript(script), /^'use strict';\{\n/, script);
    }
  });

  void it('takes no expression or later string for a directive', () => {
    for (const script of ['"use strict".length; x = 1', 'x = 1; "use strict"', '("use strict")']) {
      assert.match(wrapEvalScript(script), /^\{\n/, script);
    }
  });

  void it('keeps a hashbang a comment at its place', () => {
    assert.equal(
      wrapEvalScript('#!/usr/bin/env node\n1'),
      '{\n///usr/bin/env node\n1\n}\n//# sourceURL=bdg-eval'
    );
  });

  void it('leaves a script that does not parse on its own out of the block', () => {
    for (const script of ['} {', '}; window.pwn = 1; {', '1\n)']) {
      assert.equal(wrapEvalScript(script), `\n${script}\n//# sourceURL=bdg-eval`, script);
    }
  });

  void it('wraps a script with top-level await', () => {
    assert.match(wrapEvalScript('await 1'), /^\{\n/);
  });
});

void describe('evalLine()', () => {
  void it('takes back the block line of bdg-eval only', () => {
    assert.equal(evalLine('bdg-eval', 1), 0);
    assert.equal(evalLine('bdg-eval', 0), 0);
    assert.equal(evalLine('http://x/app.js', 3), 3);
  });
});

void describe('withEvalPositions()', () => {
  void it('corrects stack frames, not the message', () => {
    assert.equal(
      withEvalPositions('Error: see bdg-eval:5:1\n    at f (bdg-eval:3:9)\n    at bdg-eval:4:1'),
      'Error: see bdg-eval:5:1\n    at f (bdg-eval:2:9)\n    at bdg-eval:3:1'
    );
  });
});
