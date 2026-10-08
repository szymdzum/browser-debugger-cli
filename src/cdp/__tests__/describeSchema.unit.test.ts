/**
 * `--describe` details: redirects, `$ref` enums and protocol types.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getBundledProtocolVersion } from '@/cdp/protocol.js';
import { getMethodSchema, getTypeSchema } from '@/cdp/schema.js';

void describe('getMethodSchema', () => {
  void it('gives a redirected method the parameters of the method implementing it', () => {
    const schema = getMethodSchema('DOM', 'highlightNode');
    assert.equal(schema?.redirect?.method, 'Overlay.highlightNode');
    const names = schema?.redirect?.parameters.map((p) => p.name) ?? [];
    assert.ok(names.includes('highlightConfig'), names.join(','));
    assert.match(schema?.example?.command ?? '', /"highlightConfig":\{\}/);
  });

  void it('expands a $ref enum inline and names the type', () => {
    const sameSite = getMethodSchema('Network', 'setCookie')?.parameters.find(
      (p) => p.name === 'sameSite'
    );
    assert.equal(sameSite?.type, 'CookieSameSite');
    assert.equal(sameSite?.ref, 'Network.CookieSameSite');
    assert.deepEqual(sameSite?.enum, ['Strict', 'Lax', 'None']);
    assert.equal(sameSite?.refType, 'string');
  });

  void it('marks experimental parameters', () => {
    const priority = getMethodSchema('Network', 'setCookie')?.parameters.find(
      (p) => p.name === 'priority'
    );
    assert.equal(priority?.experimental, true);
  });
});

void describe('getTypeSchema', () => {
  void it('describes an enum type', () => {
    const type = getTypeSchema('network', 'cookiesamesite');
    assert.equal(type?.name, 'Network.CookieSameSite');
    assert.equal(type?.baseType, 'string');
    assert.deepEqual(type?.enum, ['Strict', 'Lax', 'None']);
  });

  void it('describes an object type with its properties', () => {
    const type = getTypeSchema('Network', 'Cookie');
    assert.equal(type?.baseType, 'object');
    const sameSite = type?.properties?.find((p) => p.name === 'sameSite');
    assert.deepEqual(sameSite?.enum, ['Strict', 'Lax', 'None']);
    assert.equal(sameSite?.required, false);
  });

  void it('is undefined for methods and unknown names', () => {
    assert.equal(getTypeSchema('Network', 'getCookies'), undefined);
    assert.equal(getTypeSchema('Nope', 'Cookie'), undefined);
  });
});

void describe('getBundledProtocolVersion', () => {
  void it('is the devtools-protocol package version', () => {
    assert.match(getBundledProtocolVersion(), /^0\.0\.\d+$/);
  });
});
