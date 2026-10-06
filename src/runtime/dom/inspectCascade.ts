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

import { truncateByLength } from '@/utils/strings.js';

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
  /** The rule as written, whitespace collapsed (no selector: the style attribute) */
  rule?: { selector?: string; declarations: string };
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
  background: [
    'background-color',
    'background-image',
    'background-position-x',
    'background-position-y',
    'background-size',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment',
  ],
  font: ['font-style', 'font-weight', 'font-size', 'line-height', 'font-family'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  outline: ['outline-width', 'outline-style', 'outline-color'],
  'text-decoration': [
    'text-decoration-line',
    'text-decoration-style',
    'text-decoration-color',
    'text-decoration-thickness',
  ],
  transition: [
    'transition-property',
    'transition-duration',
    'transition-timing-function',
    'transition-delay',
    'transition-behavior',
  ],
  'background-position': ['background-position-x', 'background-position-y'],
  'list-style': ['list-style-position', 'list-style-image', 'list-style-type'],
  columns: ['column-width', 'column-count'],
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

/** Longhands that inherit (CSS, SVG and the prefixed ones Chrome computes) */
const INHERITED = new Set(
  [
    'color caret-color accent-color color-scheme forced-color-adjust print-color-adjust',
    'font-family font-size font-style font-weight font-stretch font-size-adjust font-kerning',
    'font-optical-sizing font-palette font-language-override font-feature-settings',
    'font-variation-settings font-variant font-variant-caps font-variant-ligatures',
    'font-variant-numeric font-variant-east-asian font-variant-alternates',
    'font-variant-position font-variant-emoji font-synthesis-weight font-synthesis-style',
    'font-synthesis-small-caps line-height letter-spacing word-spacing text-align',
    'text-align-last text-indent text-justify text-transform text-shadow text-rendering',
    'text-size-adjust text-underline-position text-underline-offset text-decoration-skip-ink',
    'text-emphasis-style text-emphasis-color text-emphasis-position text-orientation',
    'text-wrap-mode text-wrap-style text-spacing-trim text-autospace white-space-collapse',
    'word-break overflow-wrap line-break hyphens hyphenate-character hyphenate-limit-chars',
    'tab-size direction writing-mode ruby-position ruby-align visibility cursor',
    'pointer-events user-select interpolate-size list-style-type list-style-position',
    'list-style-image quotes border-collapse border-spacing caption-side empty-cells orphans',
    'widows image-rendering fill fill-opacity fill-rule stroke stroke-width stroke-opacity',
    'stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit',
    'paint-order marker-start marker-mid marker-end clip-rule color-interpolation',
    'color-interpolation-filters color-rendering shape-rendering text-anchor dominant-baseline',
    'math-depth math-style math-shift scrollbar-color text-combine-upright',
    '-webkit-text-security -webkit-text-fill-color',
    '-webkit-text-stroke-color -webkit-text-stroke-width',
  ].flatMap((names) => names.split(' '))
);

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
 * @param notInherited - Custom properties registered with `inherits: false`
 * @returns True for inherited properties (custom properties inherit unless
 *   registered otherwise)
 */
export function isInherited(property: string, notInherited?: ReadonlySet<string>): boolean {
  if (property.startsWith('--')) return !notInherited?.has(property);
  return INHERITED.has(property);
}

/**
 * Custom properties registered not to inherit, with `@property` or
 * `CSS.registerProperty`.
 *
 * @param matched - `CSS.getMatchedStylesForNode` response
 * @returns Their names
 */
function nonInheritingProperties(
  matched: Protocol.CSS.GetMatchedStylesForNodeResponse
): Set<string> {
  const fromRules = (matched.cssPropertyRules ?? [])
    .filter((rule) =>
      rule.style.cssProperties.some(
        (property) => property.name === 'inherits' && property.value.trim() === 'false'
      )
    )
    .map((rule) => rule.propertyName.text);
  const fromScript = (matched.cssPropertyRegistrations ?? [])
    .filter((registration) => !registration.inherits)
    .map((registration) => registration.propertyName);
  return new Set([...fromRules, ...fromScript]);
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
 * The selector of a rule's list that matched with the highest specificity
 * (the one the cascade uses: `.title` of `h1, .title`).
 *
 * @param match - CDP rule match
 * @returns Selector
 */
function strongestMatchingSelector(match: Protocol.CSS.RuleMatch): Protocol.CSS.Value | undefined {
  const weight = (value: Protocol.CSS.Value | undefined): number => {
    const s = value?.specificity;
    return s ? s.a * 1e6 + s.b * 1e3 + s.c : -1;
  };
  const selectors = match.rule.selectorList.selectors;
  const matching = match.matchingSelectors.map((index) => selectors[index]);
  return (
    matching.reduce((best, value) => (weight(value) > weight(best) ? value : best), matching[0]) ??
    selectors[0]
  );
}

/**
 * Source of a matched rule: its matching selector (the strongest of a list),
 * origin, stylesheet, layer (nested ones as `outer.inner`), the media,
 * container, `@supports` and `@scope` conditions it is under (`not all and
 * (…)`, as Chrome writes `not (…)`, shortened) and the selector's specificity.
 *
 * @param match - CDP rule match
 * @returns Declaration source
 */
function ruleSource(match: Protocol.CSS.RuleMatch): DeclarationSource {
  const { rule } = match;
  const matching = strongestMatchingSelector(match);
  const selector = matching?.text ?? rule.selectorList.text;
  const layer = rule.layers?.map((l) => l.text || '(anonymous)').join('.');
  const condition = [
    ...[...(rule.media ?? []), ...(rule.containerQueries ?? [])].map((c) =>
      c.text.replace(/^not all and /, 'not ')
    ),
    ...(rule.supports ?? []).map((c) => `supports ${c.text}`),
    ...(rule.scopes ?? []).map((c) => `scope ${c.text}`),
  ].join(' and ');
  const specificity = matching?.specificity;
  const declarations = rule.style.cssText;
  return {
    kind: 'rule',
    selector,
    origin: rule.origin,
    ...(specificity && { specificity: [specificity.a, specificity.b, specificity.c] }),
    ...(rule.styleSheetId && { styleSheetId: rule.styleSheetId }),
    ...(layer && { layer }),
    ...(condition && { condition }),
    ...(declarations && {
      rule: { selector: collapse(rule.selectorList.text), declarations: collapse(declarations) },
    }),
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
    ...declarationsOf(entry.inlineStyle, {
      kind: 'inline',
      ...(entry.inlineStyle?.cssText && {
        rule: { declarations: collapse(entry.inlineStyle.cssText) },
      }),
    }),
  ];
}

/**
 * Text with runs of whitespace collapsed to one space.
 *
 * @param text - CSS text
 * @returns Collapsed, trimmed
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
  const notInherited = nonInheritingProperties(matched);
  const resolved = new Map<string, Resolution>();
  for (const property of properties) {
    const ranked = byPrecedence(own.filter((d) => d.property === property));
    const [winner, ...overridden] = ranked;
    if (winner) {
      resolved.set(property, { winner, overridden });
      continue;
    }
    resolved.set(property, inheritedWinner(property, ancestors, notInherited));
  }
  return resolved;
}

/**
 * The nearest ancestor's winning declaration of an inherited property.
 *
 * @param property - Longhand
 * @param ancestors - Declarations of each ancestor, nearest first
 * @param notInherited - Custom properties registered not to inherit
 * @returns The winner and the declarations it beat on that ancestor (none for
 *   non-inherited properties or when no ancestor sets it)
 */
function inheritedWinner(
  property: string,
  ancestors: Declaration[][],
  notInherited: ReadonlySet<string>
): Resolution {
  if (!isInherited(property, notInherited)) return { overridden: [] };
  for (const [depth, declarations] of ancestors.entries()) {
    const ranked = byPrecedence(declarations.filter((d) => d.property === property)).map(
      (declaration) => ({ ...declaration, ancestor: depth + 1 })
    );
    const [winner, ...overridden] = ranked;
    if (winner) return { winner, overridden };
  }
  return { overridden: [] };
}

/** Longest rule given whole; a longer one (minified CSS) is cut to the declaration */
const RULE_TEXT_LENGTH = 300;

/**
 * The rule a declaration is in, as written: whole when short, else its
 * selector and that declaration (`.btn { … background-color:var(--bs-btn-bg); … }`).
 *
 * @param declaration - Declaration
 * @returns `{ rule }`, or nothing for a browser, extension or attribute style
 */
export function ruleField(declaration: Declaration): { rule?: string } {
  const { rule } = declaration.source;
  if (!rule || !isAuthor(declaration)) return {};
  const whole = ruleText(rule.selector, rule.declarations);
  if (whole.length <= RULE_TEXT_LENGTH) return { rule: whole };
  const own = lastDeclarationOf(rule.declarations, declaration.via ?? declaration.property);
  if (!own) return { rule: truncateByLength(whole, RULE_TEXT_LENGTH) };
  const selector = rule.selector === undefined ? undefined : truncateByLength(rule.selector, 80);
  return { rule: ruleText(selector, `… ${truncateByLength(own, RULE_TEXT_LENGTH - 100)}; …`) };
}

/**
 * A rule's text: `selector { declarations }`, or `style="declarations"`.
 *
 * @param selector - Selector (absent: the style attribute)
 * @param declarations - Declarations
 * @returns Text
 */
function ruleText(selector: string | undefined, declarations: string): string {
  return selector === undefined
    ? `style="${declarations.replaceAll('"', '\\"')}"`
    : `${selector} { ${declarations} }`;
}

/**
 * The last declaration of a property in a declaration block (the one that
 * counts when it is repeated), split at semicolons outside strings and
 * parentheses (`url(data:image/png;base64,…)` stays whole).
 *
 * @param declarations - Declaration block
 * @param property - Property as written (custom properties are case-sensitive)
 * @returns The declaration, without its semicolon
 */
function lastDeclarationOf(declarations: string, property: string): string | undefined {
  const name = (part: string): string => {
    const raw = part.slice(0, part.indexOf(':')).trim();
    return raw.startsWith('--') ? raw : raw.toLowerCase();
  };
  const wanted = property.startsWith('--') ? property : property.toLowerCase();
  return splitDeclarations(declarations)
    .filter((part) => part.includes(':') && name(part) === wanted)
    .at(-1);
}

/**
 * Split a declaration block at its top-level semicolons.
 *
 * @param block - Declarations
 * @returns Declarations, trimmed, empty ones dropped
 */
function splitDeclarations(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < block.length; i++) {
    const char = block[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) {
      parts.push(block.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(block.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}
