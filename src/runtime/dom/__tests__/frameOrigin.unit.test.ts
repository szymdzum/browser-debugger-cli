/**
 * `dom frames` reports the origin a frame's scripts really run with: srcdoc
 * and about:blank inherit it, data: URLs and sandboxes are opaque.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OPAQUE_ORIGIN,
  effectiveFrameOrigin,
  isCrossOrigin,
  isOpaqueSandbox,
} from '@/runtime/dom/frameOrigin.js';

const TOP = 'http://127.0.0.1:8080';

void describe('effectiveFrameOrigin', () => {
  void it("uses the frame context's origin, `://` meaning opaque", () => {
    const srcdoc = { url: 'about:srcdoc', securityOrigin: '://', contextOrigin: TOP };
    assert.equal(effectiveFrameOrigin(srcdoc), TOP);
    const sandboxed = { url: `${TOP}/child.html`, securityOrigin: TOP, contextOrigin: '://' };
    assert.equal(effectiveFrameOrigin(sandboxed), OPAQUE_ORIGIN);
  });

  void it('lets srcdoc and about:blank frames without a context inherit the parent origin', () => {
    for (const url of ['about:srcdoc', 'about:blank', '']) {
      assert.equal(effectiveFrameOrigin({ url, securityOrigin: '://', parentOrigin: TOP }), TOP);
    }
    const inOpaque = { url: 'about:blank', securityOrigin: '://', parentOrigin: OPAQUE_ORIGIN };
    assert.equal(effectiveFrameOrigin(inOpaque), OPAQUE_ORIGIN);
  });

  void it('treats data: URLs and sandboxes without allow-same-origin as opaque', () => {
    const data = { url: 'data:text/html,<p>x</p>', securityOrigin: '://', parentOrigin: TOP };
    assert.equal(effectiveFrameOrigin(data), OPAQUE_ORIGIN);
    const sandboxed = { url: `${TOP}/a`, securityOrigin: TOP, sandbox: 'allow-scripts' };
    assert.equal(effectiveFrameOrigin(sandboxed), OPAQUE_ORIGIN);
    const allowed = { ...sandboxed, sandbox: 'allow-scripts allow-same-origin' };
    assert.equal(effectiveFrameOrigin(allowed), TOP);
  });

  void it('treats any frame without a context inside an opaque frame as opaque', () => {
    const child = { url: `${TOP}/a`, securityOrigin: TOP, parentOrigin: OPAQUE_ORIGIN };
    assert.equal(effectiveFrameOrigin(child), OPAQUE_ORIGIN);
    assert.equal(effectiveFrameOrigin({ ...child, contextOrigin: TOP }), TOP, 'context wins');
  });

  void it('falls back to the reported security origin', () => {
    const cross = { url: 'https://pay.example/', securityOrigin: 'https://pay.example' };
    assert.equal(effectiveFrameOrigin(cross), 'https://pay.example');
  });
});

void describe('isOpaqueSandbox / isCrossOrigin', () => {
  void it('reads the sandbox attribute', () => {
    assert.equal(isOpaqueSandbox(undefined), false);
    assert.equal(isOpaqueSandbox(''), true);
    assert.equal(isOpaqueSandbox('allow-forms  ALLOW-SAME-ORIGIN'), false);
  });

  void it('counts opaque origins as cross-origin', () => {
    assert.equal(isCrossOrigin(TOP, TOP), false);
    assert.equal(isCrossOrigin('https://pay.example', TOP), true);
    assert.equal(isCrossOrigin(OPAQUE_ORIGIN, OPAQUE_ORIGIN), true);
  });
});
