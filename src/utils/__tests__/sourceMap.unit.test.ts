/**
 * Source map decoding and lookup (#848, part 2). Tables: every row is a case
 * of the matrix (VLQ edge values, segments of 1, 4 and 5 fields, empty
 * lines, source spellings, columns); the last block decodes a map esbuild
 * wrote.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodeVlq, encodeMappings, type SegmentSpec } from '@/__testutils__/sourceMapBuilder.js';
import {
  decodeMappings,
  decodeVlq,
  lookupGenerated,
  parseSourceMap,
  resolveSource,
  SourceMapError,
  type MappingSegment,
} from '@/utils/sourceMap.js';

void describe('decodeVlq', () => {
  const rows: Array<[string, string, number[]]> = [
    ['zero', 'A', [0]],
    ['one', 'C', [1]],
    ['minus one', 'D', [-1]],
    ['sixteen, two digits', 'gB', [16]],
    ['minus sixteen, two digits', 'hB', [-16]],
    ['eighteen', 'kB', [18]],
    ['several values', 'AAAA', [0, 0, 0, 0]],
    ['mixed values', 'CADgB', [1, 0, -1, 16]],
    ['nothing', '', []],
  ];
  for (const [name, text, expected] of rows) {
    void it(`${name}: ${text}`, () => assert.deepEqual(decodeVlq(text), expected));
  }

  for (const value of [1000, -1000, 123456, -123456, 2 ** 30 - 1, -(2 ** 30 - 1)]) {
    void it(`round trip ${value}`, () => assert.deepEqual(decodeVlq(encodeVlq(value)), [value]));
  }

  for (const [name, text] of [
    ['a character outside base64', 'A!'],
    ['a value cut short', 'g'],
  ] as const) {
    void it(`rejects ${name}`, () => assert.throws(() => decodeVlq(text), SourceMapError));
  }
});

/**
 * Decode mappings to an array.
 *
 * @param mappings - Mappings
 * @returns Segments
 */
function decoded(mappings: string): MappingSegment[] {
  return [...decodeMappings(mappings)];
}

void describe('decodeMappings', () => {
  const rows: Array<[string, string, MappingSegment[]]> = [
    ['empty', '', []],
    ['lines without segments', ';;;', []],
    [
      'a 4-field segment',
      'AAAA',
      [{ genLine: 0, genColumn: 0, source: 0, origLine: 0, origColumn: 0 }],
    ],
    [
      'two segments on a line, columns relative',
      'AAAA,CAAC',
      [
        { genLine: 0, genColumn: 0, source: 0, origLine: 0, origColumn: 0 },
        { genLine: 0, genColumn: 1, source: 0, origLine: 0, origColumn: 1 },
      ],
    ],
    ['a 1-field segment', 'C', [{ genLine: 0, genColumn: 1 }]],
    [
      'a 5-field segment',
      'AAAAC',
      [{ genLine: 0, genColumn: 0, source: 0, origLine: 0, origColumn: 0, name: 1 }],
    ],
    [
      'the generated column starts again on a line, the rest carries over',
      'IAAI;CACA',
      [
        { genLine: 0, genColumn: 4, source: 0, origLine: 0, origColumn: 4 },
        { genLine: 1, genColumn: 1, source: 0, origLine: 1, origColumn: 4 },
      ],
    ],
    [
      'an empty line between segments and a line that goes back',
      'AACA;;AADA',
      [
        { genLine: 0, genColumn: 0, source: 0, origLine: 1, origColumn: 0 },
        { genLine: 2, genColumn: 0, source: 0, origLine: 0, origColumn: 0 },
      ],
    ],
    [
      'a second source',
      'AAAA,CCAA',
      [
        { genLine: 0, genColumn: 0, source: 0, origLine: 0, origColumn: 0 },
        { genLine: 0, genColumn: 1, source: 1, origLine: 0, origColumn: 0 },
      ],
    ],
    [
      'a negative source delta',
      'ACAA,CDAA',
      [
        { genLine: 0, genColumn: 0, source: 1, origLine: 0, origColumn: 0 },
        { genLine: 0, genColumn: 1, source: 0, origLine: 0, origColumn: 0 },
      ],
    ],
    [
      'a multi-digit value',
      'gBAAA',
      [{ genLine: 0, genColumn: 16, source: 0, origLine: 0, origColumn: 0 }],
    ],
  ];
  for (const [name, mappings, expected] of rows) {
    void it(name, () => assert.deepEqual(decoded(mappings), expected));
  }

  for (const [name, mappings] of [
    ['a 2-field segment', 'AA'],
    ['a 3-field segment', 'AAA'],
    ['a 6-field segment', 'AAAAAA'],
    ['a character outside base64', 'AA?A'],
  ] as const) {
    void it(`rejects ${name}`, () => assert.throws(() => decoded(mappings), SourceMapError));
  }
});

void describe('parseSourceMap', () => {
  const valid = { version: 3, sources: ['a.ts'], mappings: 'AAAA' };
  const accepted: Array<[string, string]> = [
    ['a version 3 map', JSON.stringify(valid)],
    ['a map with the XSSI prefix', `)]}'\n${JSON.stringify(valid)}`],
  ];
  for (const [name, text] of accepted) {
    void it(name, () => assert.deepEqual(parseSourceMap(text).sources, ['a.ts']));
  }

  void it('keeps sourceRoot, empty when absent', () => {
    assert.equal(parseSourceMap(JSON.stringify(valid)).sourceRoot, '');
    assert.equal(
      parseSourceMap(JSON.stringify({ ...valid, sourceRoot: 'src/' })).sourceRoot,
      'src/'
    );
  });

  const rejected: Array<[string, string, RegExp]> = [
    ['an indexed map', JSON.stringify({ version: 3, sections: [] }), /sections/],
    ['text that is not JSON', 'nope', /JSON/],
    ['another version', JSON.stringify({ ...valid, version: 2 }), /version/],
    ['no mappings', JSON.stringify({ version: 3, sources: [] }), /mappings/],
    ['no sources', JSON.stringify({ version: 3, mappings: '' }), /sources/],
  ];
  for (const [name, text, reason] of rejected) {
    void it(`rejects ${name}`, () => assert.throws(() => parseSourceMap(text), reason));
  }
});

void describe('resolveSource', () => {
  const map = 'http://h/dist/app.js.map';
  const rows: Array<[string, string, string, string, string]> = [
    ['plain', 'src/a.ts', '', map, 'http://h/dist/src/a.ts'],
    ['./', './src/a.ts', '', map, 'http://h/dist/src/a.ts'],
    ['../', '../src/a.ts', '', map, 'http://h/src/a.ts'],
    ['webpack://', 'webpack://app/./src/a.ts', '', map, 'webpack://app/src/a.ts'],
    ['absolute URL', 'http://cdn/x/a.ts', '', map, 'http://cdn/x/a.ts'],
    ['sourceRoot with slash', 'a.ts', 'src/', map, 'http://h/dist/src/a.ts'],
    ['sourceRoot without slash', 'a.ts', 'src', map, 'http://h/dist/src/a.ts'],
    ['absolute path sourceRoot', 'a.ts', '/abs', map, 'http://h/abs/a.ts'],
    ['URL sourceRoot', 'a.ts', 'http://cdn/r/', map, 'http://cdn/r/a.ts'],
    ['query on the map URL', './a.ts', '', 'http://h/dist/app.js.map?v=3', 'http://h/dist/a.ts'],
    ['a source with a query', 'a.ts?x=1', '', map, 'http://h/dist/a.ts?x=1'],
    [
      'base is a script URL (inline map)',
      'src/a.ts',
      '',
      'http://h/dist/app.js?v=2',
      'http://h/dist/src/a.ts',
    ],
  ];
  for (const [name, source, root, base, expected] of rows) {
    void it(name, () => assert.equal(resolveSource(source, root, base), expected));
  }
});

/** Segments of a two-source map: cart.ts (source 0) and util.ts (source 1) */
const SEGMENTS: SegmentSpec[] = [
  { genLine: 0, genColumn: 0, source: 0, origLine: 1, origColumn: 0 },
  { genLine: 0, genColumn: 10, source: 0, origLine: 1, origColumn: 12 },
  { genLine: 1, genColumn: 4, source: 0, origLine: 2, origColumn: 2 },
  { genLine: 1, genColumn: 20, source: 0, origLine: 2, origColumn: 10 },
  { genLine: 2, genColumn: 0, source: 1, origLine: 0, origColumn: 0 },
  { genLine: 3, genColumn: 2, source: 0, origLine: 3, origColumn: 0 },
  { genLine: 5, genColumn: 3, source: 0, origLine: 3, origColumn: 0 },
];

/** Map for the lookup rows */
function lookupMap(sources: string[], sourceRoot = ''): ReturnType<typeof parseSourceMap> {
  return parseSourceMap(
    JSON.stringify({ version: 3, sourceRoot, sources, mappings: encodeMappings(SEGMENTS) })
  );
}

void describe('lookupGenerated', () => {
  const base = 'http://h/dist/app.js.map';
  const map = lookupMap(['../src/cart.ts', '../src/util.ts']);
  const rows: Array<[string, string, number, number | undefined, [number, number] | undefined]> = [
    ['first segment of the line', 'src/cart.ts', 2, undefined, [1, 1]],
    ['file by its end', 'cart.ts', 3, undefined, [2, 5]],
    ['the segment at or before the column', 'cart.ts', 3, 12, [2, 21]],
    ['a column before the first segment', 'cart.ts', 3, 1, [2, 5]],
    ['a column between segments', 'cart.ts', 3, 6, [2, 5]],
    ['first of two generated positions', 'cart.ts', 4, undefined, [4, 3]],
    ['the other source', 'util.ts', 1, undefined, [3, 1]],
    ['full URL', 'http://h/src/cart.ts', 2, undefined, [1, 1]],
  ];
  for (const [name, file, line, column, expected] of rows) {
    void it(name, () => {
      const result = lookupGenerated(map, base, file, line, column);
      assert.equal(result.kind, 'found');
      if (result.kind !== 'found') return;
      assert.deepEqual([result.positions[0]?.line, result.positions[0]?.column], expected);
      assert.equal(result.positions[0]?.originalLine, line);
    });
  }

  void it('a line without a segment has no code, and says which source', () => {
    assert.deepEqual(lookupGenerated(map, base, 'cart.ts', 5), {
      kind: 'no-code',
      source: 'http://h/src/cart.ts',
    });
  });

  for (const file of ['other.ts', 'art.ts', 'cart', 'src/cart.t']) {
    void it(`no source named ${file}`, () => {
      assert.deepEqual(lookupGenerated(map, base, file, 2), { kind: 'no-source' });
    });
  }

  void it('a file two sources end with gives a position for each', () => {
    const both = lookupMap(['../a/cart.ts', '../b/cart.ts']);
    const result = lookupGenerated(both, base, 'cart.ts', 2);
    assert.equal(result.kind === 'found' ? result.positions.length : 0, 1);
  });

  void it('sourceRoot is part of the match', () => {
    const rooted = lookupMap(['cart.ts', 'util.ts'], 'src');
    assert.equal(lookupGenerated(rooted, base, 'src/cart.ts', 2).kind, 'found');
  });

  void it('a source with a query matches the file without it', () => {
    assert.equal(lookupGenerated(lookupMap(['cart.ts?v=1']), base, 'cart.ts', 2).kind, 'found');
  });
});

/**
 * What `esbuild src/cart.ts --bundle --minify --sourcemap` wrote for two
 * TypeScript files (the bundle is one line, `names` present).
 */
const ESBUILD_BUNDLE =
  '(()=>{function r(t,e){let o=t*e;return t+o}function c(t){let e=0;for(let n of t)e+=n.price;return r(e,.2)}console.log(c([{price:10}]));})();';

const ESBUILD_MAP = JSON.stringify({
  version: 3,
  sources: ['../src/tax.ts', '../src/cart.ts'],
  mappings:
    'MAAO,SAASA,EAAOC,EAAgBC,EAAsB,CAC3D,IAAMC,EAAMF,EAASC,EACrB,OAAOD,EAASE,CAClB,CCDO,SAASC,EAAaC,EAAuB,CAClD,IAAIC,EAAW,EACf,QAAWC,KAAQF,EAAOC,GAAYC,EAAK,MAE3C,OADcC,EAAOF,EAAU,EAAG,CAEpC,CACA,QAAQ,IAAIF,EAAa,CAAC,CAAE,MAAO,EAAG,CAAC,CAAC,CAAC',
  names: ['addTax', 'amount', 'rate', 'tax', 'computeTotal', 'items', 'subtotal', 'item', 'addTax'],
});

void describe('a map esbuild wrote', () => {
  const map = parseSourceMap(ESBUILD_MAP);
  const base = 'http://h/dist/cart.js.map';
  const rows: Array<[string, string, number, string]> = [
    ['tax.ts: the function', 'src/tax.ts', 1, 'function r(t,e)'],
    ['tax.ts: a statement', 'src/tax.ts', 2, 'let o=t*e'],
    ['tax.ts: the return', 'src/tax.ts', 3, 'return t+o'],
    ['cart.ts: the function', 'src/cart.ts', 3, 'function c(t)'],
    ['cart.ts: a statement', 'src/cart.ts', 4, 'let e=0'],
    ['cart.ts: the loop', 'src/cart.ts', 5, 'for(let n of t)'],
    ['cart.ts: a line whose position comes after a later line', 'src/cart.ts', 6, 'r(e,.2)}'],
    ['cart.ts: the call at the end', 'src/cart.ts', 9, 'console.log'],
  ];
  for (const [name, file, line, text] of rows) {
    void it(name, () => {
      const result = lookupGenerated(map, base, file, line);
      assert.equal(result.kind, 'found');
      if (result.kind !== 'found') return;
      const position = result.positions[0];
      assert.equal(position?.line, 1);
      assert.ok(
        ESBUILD_BUNDLE.slice((position?.column ?? 1) - 1).startsWith(text),
        `${position?.column}`
      );
    });
  }

  void it('the import line and the type line compile to nothing', () => {
    assert.equal(lookupGenerated(map, base, 'src/cart.ts', 1).kind, 'no-code');
    assert.equal(lookupGenerated(map, base, 'src/cart.ts', 2).kind, 'no-code');
  });

  void it('decodes every segment of the map', () => {
    const segments = decoded(map.mappings);
    assert.ok(segments.length > 40);
    assert.ok(segments.every((segment) => segment.genLine <= 1));
    assert.ok(segments.some((segment) => segment.source === 1));
  });
});
