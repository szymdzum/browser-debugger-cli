/**
 * Which declaration sets a property of an element: the CSS cascade computed
 * from `CSS.getMatchedStylesForNode` (Chrome reports the matching rules, not
 * which declaration wins).
 *
 * The rules come in ascending precedence (user-agent first, then layered
 * rules in layer order, then unlayered rules by specificity and source
 * order), between the presentational attributes and the style attribute.
 * The last normal declaration wins unless an `!important` one exists; among
 * important ones the style attribute wins, then layered ones (earlier layers
 * first), then unlayered ones. Shorthands are expanded into their longhands
 * and logical properties mapped to physical ones (horizontal, left-to-right
 * writing). With no declaration of its own, an inherited property comes from
 * the nearest ancestor that declares it.
 */

import type { Protocol } from 'devtools-protocol';

/** Where a declaration comes from */
export interface DeclarationSource {
  /** `rule` (a stylesheet rule), `inline` (style attribute), `attribute` (presentational HTML attribute) */
  kind: 'rule' | 'inline' | 'attribute';
  /** The matching selector of the rule */
  selector?: string;
  /** `regular`, `user-agent`, `injected`, `inspector` */
  origin?: string;
  styleSheetId?: string;
  /** 0-based line and column in the stylesheet (as CDP reports them) */
  line?: number;
  column?: number;
  /** Cascade layer, e.g. `utilities` */
  layer?: string;
  /** Media or container condition the rule is under, e.g. `(min-width: 80rem)` */
  condition?: string;
  /** Specificity of the matching selector (ids, classes, types) */
  specificity?: [number, number, number];
}

/** One declaration of a longhand */
export interface Declaration {
  /** Longhand it sets (a shorthand or logical property mapped to it) */
  property: string;
  /** Value this longhand gets (Chrome's expansion, or the written value when it has `var()`) */
  value: string;
  /** Property as written, when it is not the longhand (`padding`, `margin-inline-start`) */
  via?: string;
  /** Value as written, when set via another property (`4px 8px` for `padding`) */
  written?: string;
  important: boolean;
  source: DeclarationSource;
  /** How many ancestors up it was declared (absent: on the element) */
  ancestor?: number;
}

/** The cascade of one property */
export interface Resolution {
  /** The winning declaration, absent when nothing authored sets it (initial or inherited default) */
  winner?: Declaration;
  /** Declarations that lost (of the element, or of the ancestor it inherits from), highest precedence first */
  overridden: Declaration[];
}

/**
 * The four side longhands of a pattern.
 *
 * @param pattern - e.g. `border-{side}-width`
 * @returns Top, right, bottom, left
 */
function sideLonghands(pattern: string): string[] {
  return ['top', 'right', 'bottom', 'left'].map((side) => pattern.replace('{side}', side));
}

/** Longhands of common shorthands, for values with `var()` (CDP leaves those unexpanded) */
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  inset: ['top', 'right', 'bottom', 'left'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  'border-width': [
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ],
  'border-style': [
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
  ],
  'border-color': [
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
  ],
  'border-radius': [
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
  ],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  'inset-inline': ['left', 'right'],
  'inset-block': ['top', 'bottom'],
  border: ['width', 'style', 'color'].flatMap((part) => sideLonghands('border-{side}-' + part)),
  ...Object.fromEntries(
    ['top', 'right', 'bottom', 'left'].map((side) => [
      `border-${side}`,
      ['width', 'style', 'color'].map((part) => `border-${side}-${part}`),
    ])
  ),
  background: ['background-color', 'background-image'],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
};

/** Physical longhand of a logical one (horizontal-tb, ltr) */
const LOGICAL_TO_PHYSICAL: Readonly<Record<string, string>> = {
  'inline-size': 'width',
  'block-size': 'height',
  'min-inline-size': 'min-width',
  'min-block-size': 'min-height',
  'max-inline-size': 'max-width',
  'max-block-size': 'max-height',
  'inset-block-start': 'top',
  'inset-block-end': 'bottom',
  'inset-inline-start': 'left',
  'inset-inline-end': 'right',
};

/** Sides of the logical box properties (block-start → top, …) */
const LOGICAL_SIDES: Readonly<Record<string, string>> = {
  'block-start': 'top',
  'block-end': 'bottom',
  'inline-start': 'left',
  'inline-end': 'right',
};

/** Properties that inherit (those `dom inspect` reports) */
const INHERITED = new Set([
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'font-variant',
  'font-feature-settings',
  'font-variation-settings',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-indent',
  'text-transform',
  'text-shadow',
  'white-space-collapse',
  'text-wrap-mode',
  'visibility',
  'cursor',
  'direction',
  'list-style-type',
  'list-style-position',
  'tab-size',
  'pointer-events',
  'user-select',
  '-webkit-text-security',
]);

/**
 * The longhands of a shorthand.
 *
 * @param name - Property name
 * @returns Its longhands, or undefined when it is not a known shorthand
 */
export function shorthandLonghands(name: string): readonly string[] | undefined {
  return Object.hasOwn(SHORTHANDS, name) ? SHORTHANDS[name] : undefined;
}

/**
 * Whether a property inherits.
 *
 * @param property - Longhand
 * @returns True for inherited properties (custom properties inherit)
 */
export function isInherited(property: string): boolean {
  return INHERITED.has(property) || property.startsWith('--');
}

/**
 * The physical longhand a logical property sets.
 *
 * @param name - Property as written
 * @returns Physical name, or the name itself
 */
export function physicalName(name: string): string {
  const direct = LOGICAL_TO_PHYSICAL[name];
  if (direct) return direct;
  const match =
    /^(margin|padding|border|scroll-margin|scroll-padding)-(block-start|block-end|inline-start|inline-end)(-(width|style|color))?$/.exec(
      name
    );
  if (!match) return name;
  const side = LOGICAL_SIDES[match[2] ?? ''] ?? '';
  return `${match[1]}-${side}${match[3] ?? ''}`;
}

/**
 * The longhands one written property sets, with the value each gets.
 *
 * @param property - CDP property (with `longhandProperties` when Chrome expanded it)
 * @returns Longhand names and values
 */
function longhandsOf(property: Protocol.CSS.CSSProperty): Array<{ name: string; value: string }> {
  if (property.longhandProperties && property.longhandProperties.length > 0) {
    return property.longhandProperties.map((longhand) => ({
      name: physicalName(longhand.name),
      value: longhand.value,
    }));
  }
  const expanded = SHORTHANDS[property.name];
  if (expanded) return expanded.map((name) => ({ name, value: property.value }));
  return [{ name: physicalName(property.name), value: property.value }];
}

/**
 * The declarations a CSS style block sets, longhand by longhand. Only
 * declarations as written count (CDP adds unranged duplicates); disabled
 * and invalid ones do not. A shorthand with `var()` gives each longhand the
 * value as written: Chrome cannot expand it before substitution and reports
 * the initial values (`currentcolor` for `border: 2px solid var(--c)`).
 *
 * @param style - CDP style
 * @param source - Where the block comes from
 * @returns Declarations
 */
function declarationsOf(
  style: Protocol.CSS.CSSStyle | undefined,
  source: DeclarationSource
): Declaration[] {
  if (!style) return [];
  return style.cssProperties
    .filter(
      (property) =>
        property.range !== undefined ||
        source.origin === 'user-agent' ||
        source.kind === 'attribute'
    )
    .filter((property) => property.disabled !== true && property.parsedOk !== false)
    .flatMap((property) => {
      const written = property.value.replace(/\s*!important\s*$/, '');
      return longhandsOf(property).map(({ name, value }) => ({
        property: name,
        value:
          property.longhandProperties && value !== '' && !written.includes('var(')
            ? value
            : written,
        ...(name !== property.name && { via: property.name, written }),
        important: property.important === true,
        source: {
          ...source,
          ...(property.range && {
            line: property.range.startLine,
            column: property.range.startColumn,
          }),
        },
      }));
    });
}

/**
 * Source of a matched rule: its matching selector, origin, stylesheet,
 * layer (nested ones as `outer.inner`), the media or container condition
 * it is under (`not all and (…)`, as Chrome writes `not (…)`, shortened) and
 * the selector's specificity.
 *
 * @param match - CDP rule match
 * @returns Declaration source
 */
function ruleSource(match: Protocol.CSS.RuleMatch): DeclarationSource {
  const { rule } = match;
  const matching = rule.selectorList.selectors[match.matchingSelectors[0] ?? 0];
  const selector = matching?.text ?? rule.selectorList.text;
  const layer = rule.layers?.map((l) => l.text || '(anonymous)').join('.');
  const condition = [...(rule.media ?? []), ...(rule.containerQueries ?? [])]
    .map((c) => c.text.replace(/^not all and /, 'not '))
    .join(' and ');
  const specificity = matching?.specificity;
  return {
    kind: 'rule',
    selector,
    origin: rule.origin,
    ...(specificity && { specificity: [specificity.a, specificity.b, specificity.c] }),
    ...(rule.styleSheetId && { styleSheetId: rule.styleSheetId }),
    ...(layer && { layer }),
    ...(condition && { condition }),
  };
}

/**
 * The declarations of one element in ascending cascade order.
 *
 * @param entry - Inline style, presentational attributes and matched rules
 * @returns Declarations, lowest precedence first
 */
function orderedDeclarations(entry: {
  attributesStyle?: Protocol.CSS.CSSStyle;
  matchedCSSRules?: Protocol.CSS.RuleMatch[];
  inlineStyle?: Protocol.CSS.CSSStyle;
}): Declaration[] {
  return [
    ...declarationsOf(entry.attributesStyle, { kind: 'attribute' }),
    ...(entry.matchedCSSRules ?? []).flatMap((match) =>
      declarationsOf(match.rule.style, ruleSource(match))
    ),
    ...declarationsOf(entry.inlineStyle, { kind: 'inline' }),
  ];
}

/**
 * Whether a declaration comes from the page's authors (not the browser's
 * own stylesheet or an extension's).
 *
 * @param declaration - Declaration
 * @returns True for author declarations
 */
function isAuthor(declaration: Declaration): boolean {
  const { origin } = declaration.source;
  return origin === undefined || origin === 'regular' || origin === 'inspector';
}

/**
 * Precedence of a declaration within one element's list. Normal: author over
 * browser; then the style attribute; then by layer (presentational
 * attributes below every layer, unlayered rules above); then by position.
 * Important: browser over author; the style attribute; layers reversed
 * (unlayered lowest); position.
 *
 * @param declaration - Declaration
 * @param position - Its index in ascending order
 * @param layers - Layer names in the order they first appear
 * @returns Comparable tuple, higher wins
 */
function precedence(declaration: Declaration, position: number, layers: string[]): number[] {
  const { layer, kind } = declaration.source;
  const layerIndex = layer === undefined ? -1 : layers.indexOf(layer);
  const author = isAuthor(declaration) ? 1 : 0;
  const inline = kind === 'inline' ? 1 : 0;
  if (!declaration.important) {
    const layerRank = kind === 'attribute' ? -1 : layer === undefined ? layers.length : layerIndex;
    return [0, author, inline, layerRank, position];
  }
  return [1, 1 - author, inline, layer === undefined ? -1 : layers.length - layerIndex, position];
}

/**
 * Compare two precedence tuples.
 *
 * @param a - Tuple
 * @param b - Tuple
 * @returns Positive when a wins
 */
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Sort one element's declarations of a property, winner first.
 *
 * @param declarations - Declarations in ascending order
 * @returns Highest precedence first
 */
function byPrecedence(declarations: Declaration[]): Declaration[] {
  const layers = [
    ...new Set(declarations.flatMap((d) => (d.source.layer ? [d.source.layer] : []))),
  ];
  return declarations
    .map((declaration, position) => ({
      declaration,
      key: precedence(declaration, position, layers),
    }))
    .sort((a, b) => compare(b.key, a.key))
    .map((entry) => entry.declaration);
}

/**
 * The longhands the element's own declarations set (what hints check).
 *
 * @param matched - `CSS.getMatchedStylesForNode` response
 * @returns Longhands
 */
export function ownProperties(matched: Protocol.CSS.GetMatchedStylesForNodeResponse): string[] {
  return [...new Set(orderedDeclarations(matched).map((declaration) => declaration.property))];
}

/**
 * Resolve the cascade of the given properties for an element.
 *
 * @param matched - `CSS.getMatchedStylesForNode` response
 * @param properties - Longhands to resolve
 * @returns Resolution per property
 */
export function resolveCascade(
  matched: Protocol.CSS.GetMatchedStylesForNodeResponse,
  properties: readonly string[]
): Map<string, Resolution> {
  const own = orderedDeclarations(matched);
  const ancestors = (matched.inherited ?? []).map(orderedDeclarations);
  const resolved = new Map<string, Resolution>();
  for (const property of properties) {
    const ranked = byPrecedence(own.filter((d) => d.property === property));
    const [winner, ...overridden] = ranked;
    if (winner) {
      resolved.set(property, { winner, overridden });
      continue;
    }
    resolved.set(property, inheritedWinner(property, ancestors));
  }
  return resolved;
}

/**
 * The nearest ancestor's winning declaration of an inherited property.
 *
 * @param property - Longhand
 * @param ancestors - Declarations of each ancestor, nearest first
 * @returns The winner and the declarations it beat on that ancestor (none for
 *   non-inherited properties or when no ancestor sets it)
 */
function inheritedWinner(property: string, ancestors: Declaration[][]): Resolution {
  if (!isInherited(property)) return { overridden: [] };
  for (const [depth, declarations] of ancestors.entries()) {
    const ranked = byPrecedence(declarations.filter((d) => d.property === property)).map(
      (declaration) => ({ ...declaration, ancestor: depth + 1 })
    );
    const [winner, ...overridden] = ranked;
    if (winner) return { winner, overridden };
  }
  return { overridden: [] };
}
