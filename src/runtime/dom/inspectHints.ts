/**
 * Declarations that have no effect, with why and what to change: Chrome
 * DevTools' inactive-CSS rules (CSSRuleValidator) plus some of Firefox's,
 * checked against authored declarations only (never the browser's own
 * styles), and `var()` references to custom properties that are not set.
 */

import type { Declaration, Resolution } from '@/runtime/dom/inspectCascade.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';

/** A declaration that has no effect */
export interface CssHint {
  /** Property as written */
  property: string;
  /** Its value */
  value: string;
  /** Why it has no effect */
  reason: string;
  /** What would make it work */
  fix: string;
  /** The declaration */
  declaration: Declaration;
}

/** What the checks look at */
interface HintContext {
  style: StyleMap;
  parentStyle: StyleMap | undefined;
  /** The element is replaced (img, input, video…) */
  replaced: boolean;
}

/** A check: when it applies, why the declaration has no effect and the fix */
interface Rule {
  properties: readonly string[];
  inactive: (ctx: HintContext) => { reason: string; fix: string } | undefined;
}

const display = (style: StyleMap | undefined): string => style?.['display'] ?? 'inline';
const isFlex = (value: string): boolean => /(^|-)flex$/.test(value);
const isGrid = (value: string): boolean => /(^|-)grid$/.test(value);
const isFlexOrGrid = (value: string): boolean => isFlex(value) || isGrid(value);
const isMulticol = (style: StyleMap): boolean =>
  (style['column-count'] ?? 'auto') !== 'auto' || (style['column-width'] ?? 'auto') !== 'auto';

/** The checks, in DevTools' wording */
const RULES: readonly Rule[] = [
  {
    properties: ['flex-direction', 'flex-wrap', 'flex-flow'],
    inactive: ({ style }) =>
      isFlex(display(style))
        ? undefined
        : { reason: `display is ${display(style)}`, fix: 'use display: flex or inline-flex' },
  },
  {
    properties: [
      'grid-template-columns',
      'grid-template-rows',
      'grid-template-areas',
      'grid-auto-flow',
      'grid-auto-columns',
      'grid-auto-rows',
    ],
    inactive: ({ style }) =>
      isGrid(display(style))
        ? undefined
        : { reason: `display is ${display(style)}`, fix: 'use display: grid or inline-grid' },
  },
  {
    properties: ['justify-content', 'align-items', 'row-gap'],
    inactive: ({ style }) =>
      isFlexOrGrid(display(style))
        ? undefined
        : {
            reason: `display is ${display(style)}`,
            fix: 'use display: flex or grid on this element',
          },
  },
  {
    properties: ['column-gap'],
    inactive: ({ style }) =>
      isFlexOrGrid(display(style)) || isMulticol(style)
        ? undefined
        : {
            reason: `display is ${display(style)}`,
            fix: 'use display: flex or grid on this element (or columns)',
          },
  },
  {
    properties: ['align-content'],
    inactive: ({ style }) => {
      if (isFlex(display(style)) && (style['flex-wrap'] ?? 'nowrap') === 'nowrap') {
        return { reason: 'flex-wrap is nowrap (one line)', fix: 'use flex-wrap: wrap' };
      }
      return undefined;
    },
  },
  {
    properties: ['flex', 'flex-grow', 'flex-shrink', 'flex-basis'],
    inactive: ({ parentStyle }) =>
      isFlex(display(parentStyle))
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: flex on the parent',
          },
  },
  {
    properties: [
      'grid-area',
      'grid-column',
      'grid-row',
      'grid-column-start',
      'grid-column-end',
      'grid-row-start',
      'grid-row-end',
    ],
    inactive: ({ parentStyle }) =>
      isGrid(display(parentStyle))
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: grid on the parent',
          },
  },
  {
    properties: ['order', 'align-self'],
    inactive: ({ style, parentStyle }) =>
      isFlexOrGrid(display(parentStyle)) || /^(absolute|fixed)$/.test(style['position'] ?? '')
        ? undefined
        : {
            reason: `the parent's display is ${display(parentStyle)}`,
            fix: 'use display: flex or grid on the parent',
          },
  },
  {
    properties: ['top', 'right', 'bottom', 'left', 'inset'],
    inactive: ({ style }) =>
      (style['position'] ?? 'static') === 'static'
        ? { reason: 'position is static', fix: 'use position: relative, absolute, fixed or sticky' }
        : undefined,
  },
  {
    properties: ['z-index'],
    inactive: ({ style, parentStyle }) =>
      (style['position'] ?? 'static') === 'static' && !isFlexOrGrid(display(parentStyle))
        ? { reason: 'position is static', fix: 'use position: relative (or another than static)' }
        : undefined,
  },
  {
    properties: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
    inactive: ({ style, replaced }) =>
      display(style) === 'inline' && !replaced
        ? { reason: 'display is inline', fix: 'use display: inline-block or block' }
        : undefined,
  },
  {
    properties: ['margin-top', 'margin-bottom'],
    inactive: ({ style, replaced }) =>
      display(style) === 'inline' && !replaced
        ? {
            reason: 'display is inline (vertical margins do not move it)',
            fix: 'use display: inline-block or block',
          }
        : undefined,
  },
  {
    properties: ['vertical-align'],
    inactive: ({ style }) =>
      /^(inline|inline-block|inline-flex|inline-grid|table-cell)$/.test(display(style))
        ? undefined
        : {
            reason: `display is ${display(style)}`,
            fix: 'vertical-align works on inline and table-cell boxes; use flex alignment instead',
          },
  },
  {
    properties: ['text-overflow'],
    inactive: ({ style }) =>
      (style['overflow-x'] ?? 'visible') === 'visible'
        ? {
            reason: 'overflow is visible (nothing is cut)',
            fix: 'add overflow: hidden and white-space: nowrap',
          }
        : undefined,
  },
  {
    properties: ['float'],
    inactive: ({ parentStyle }) =>
      isFlexOrGrid(display(parentStyle))
        ? {
            reason: `the parent is a ${display(parentStyle)} container`,
            fix: 'remove float; use flex or grid alignment',
          }
        : undefined,
  },
  {
    properties: ['object-fit', 'object-position'],
    inactive: ({ replaced }) =>
      replaced
        ? undefined
        : {
            reason: 'the element is not an image or video',
            fix: 'use background-size/position for backgrounds',
          },
  },
];

/**
 * Declarations of the element that have no effect: every longhand a
 * declaration wins is inactive (`margin: 0 4px` on an inline element still
 * moves it sideways, `gap` on a multi-column block still spaces the columns).
 *
 * @param cascade - Resolved properties (winning declarations are checked)
 * @param ctx - Computed styles of the element and its parent
 * @returns Hints, in property order
 */
export function inactiveHints(cascade: Map<string, Resolution>, ctx: HintContext): CssHint[] {
  return [...ownWinnersByDeclaration(cascade).values()].flatMap((winners) => {
    const checks = winners.map((declaration) =>
      RULES.find((rule) => rule.properties.includes(declaration.property))?.inactive(ctx)
    );
    const [first] = winners;
    const [inactive] = checks;
    if (!first || !inactive || checks.some((check) => !check)) return [];
    return [
      {
        property: first.via ?? first.property,
        value: first.written ?? first.value,
        ...inactive,
        declaration: first,
      },
    ];
  });
}

/**
 * The element's own authored winning declarations, the longhands each wins
 * grouped by the declaration as written.
 *
 * @param cascade - Resolved properties
 * @returns Winning longhands by declaration
 */
function ownWinnersByDeclaration(cascade: Map<string, Resolution>): Map<string, Declaration[]> {
  const groups = new Map<string, Declaration[]>();
  for (const { winner } of cascade.values()) {
    if (!winner || winner.ancestor !== undefined || winner.source.origin === 'user-agent') continue;
    const { source } = winner;
    const key = [
      winner.via ?? winner.property,
      source.kind,
      source.styleSheetId,
      source.line,
      source.column,
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), winner]);
  }
  return groups;
}

/**
 * Winning declarations that use a custom property that is not set: the
 * declaration is invalid at computed-value time, so the property falls back
 * to inherited or initial.
 *
 * @param cascade - Resolved properties
 * @param style - Computed styles of the element (custom properties included)
 * @returns Hints
 */
export function undefinedVariableHints(
  cascade: Map<string, Resolution>,
  style: StyleMap
): CssHint[] {
  const hints: CssHint[] = [];
  const seen = new Set<string>();
  for (const resolution of cascade.values()) {
    const declaration = resolution.winner;
    if (!declaration || declaration.ancestor !== undefined) continue;
    const value = declaration.written ?? declaration.value;
    const missing = unsetVariables(value, style);
    const written = declaration.via ?? declaration.property;
    if (missing.length === 0 || seen.has(written)) continue;
    seen.add(written);
    hints.push({
      property: written,
      value,
      reason: `${missing.join(', ')} is not set`,
      fix: `define ${missing[0]} or give var() a fallback`,
      declaration,
    });
  }
  return hints;
}

/**
 * The custom properties a value uses that are not set and have no fallback:
 * the fallback of an unset one is used instead (and checked in turn), the
 * fallback of a set one never.
 *
 * @param value - Value as written
 * @param style - Computed styles (custom properties included)
 * @returns Names of the unset custom properties
 */
export function unsetVariables(value: string, style: StyleMap): string[] {
  const missing: string[] = [];
  let rest = value;
  for (let start = rest.indexOf('var('); start !== -1; start = rest.indexOf('var(')) {
    const end = closingParen(rest, start + 3);
    const [name = '', ...fallback] = rest.slice(start + 4, end).split(',');
    const variable = name.trim();
    if (style[variable] === undefined) {
      missing.push(
        ...(fallback.length > 0 ? unsetVariables(fallback.join(','), style) : [variable])
      );
    }
    rest = rest.slice(end + 1);
  }
  return missing;
}

/**
 * Index of the parenthesis that closes the one at `open`.
 *
 * @param text - Text
 * @param open - Index of `(`
 * @returns Index of the matching `)` (the end of the text when unbalanced)
 */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')' && --depth === 0) return i;
  }
  return text.length;
}
