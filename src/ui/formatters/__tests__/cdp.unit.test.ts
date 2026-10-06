/**
 * Human-readable `bdg cdp` output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatCdpDescription,
  formatCdpDomainMethods,
  formatCdpDomains,
  formatCdpResult,
  formatCdpSearch,
} from '@/ui/formatters/cdp.js';

void describe('formatCdpSearch', () => {
  void it('lists matches with the first sentence of their description', () => {
    const output = formatCdpSearch({
      query: 'cookie',
      count: 2,
      methods: [
        {
          name: 'Network.getCookies',
          domain: 'Network',
          method: 'getCookies',
          description: 'Returns all browser cookies. Depending on the backend.',
          parameterCount: 1,
        },
        {
          name: 'Page.deleteCookie',
          domain: 'Page',
          method: 'deleteCookie',
          experimental: true,
          deprecated: true,
          parameterCount: 2,
        },
      ],
    });
    assert.equal(
      output,
      [
        '2 methods match "cookie":',
        '  Network.getCookies  Returns all browser cookies.',
        '  Page.deleteCookie   (experimental, deprecated)',
        'Parameters and an example: bdg cdp <Domain.method> --describe',
      ].join('\n')
    );
  });

  void it('says when nothing matches', () => {
    assert.match(
      formatCdpSearch({ query: 'zzz', count: 0, methods: [] }),
      /^No CDP method matches "zzz"/
    );
  });
});

void describe('formatCdpDomains and formatCdpDomainMethods', () => {
  void it('list domains with counts and methods with descriptions', () => {
    const domains = formatCdpDomains({
      count: 1,
      domains: [{ name: 'Audits', commands: 4, events: 1, experimental: true }],
    });
    assert.match(domains, /^1 CDP domain:\n {2}Audits {2}4 methods, 1 event \(experimental\)/);
    const methods = formatCdpDomainMethods({
      domain: 'Network',
      description: 'Network domain.\nMore.',
      count: 1,
      methods: [
        {
          name: 'enable',
          fullName: 'Network.enable',
          description: 'Enables network tracking.',
          parameterCount: 0,
          parameters: [],
          returns: [],
        },
      ],
    });
    assert.match(
      methods,
      /^Network: 1 method\nNetwork domain\.\n {2}enable {2}Enables network tracking\./
    );
  });
});

void describe('formatCdpDescription', () => {
  void it('shows parameters (? = optional), returns, note and example', () => {
    const output = formatCdpDescription({
      type: 'method',
      name: 'Network.getCookies',
      domain: 'Network',
      method: 'getCookies',
      description: 'Returns all browser cookies.',
      parameters: [
        {
          name: 'urls',
          type: 'array',
          items: 'string',
          required: false,
          description: 'URLs\nof frames',
        },
      ],
      returns: [{ name: 'cookies', type: 'array', items: 'Cookie', optional: false }],
      example: { command: 'bdg cdp Network.getCookies' },
    });
    assert.equal(
      output,
      [
        'Network.getCookies',
        'Returns all browser cookies.',
        'Parameters:',
        '  urls?: array<string>  URLs of frames',
        'Returns:',
        '  cookies: array<Cookie>',
        'Example: bdg cdp Network.getCookies',
      ].join('\n')
    );
  });
});

void describe('formatCdpResult', () => {
  void it('prints the result as JSON, or says there is none', () => {
    assert.equal(
      formatCdpResult({ method: 'Runtime.evaluate', result: { result: { value: 2 } } }),
      '{\n  "result": {\n    "value": 2\n  }\n}'
    );
    assert.equal(
      formatCdpResult({ method: 'Network.enable', result: {} }),
      'Network.enable: done (no result data)'
    );
  });
});
