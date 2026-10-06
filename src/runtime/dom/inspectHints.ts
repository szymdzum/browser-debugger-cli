/**
 * Declarations that have no effect, with why and what to change: Chrome
 * DevTools' inactive-CSS rules (CSSRuleValidator) plus some of Firefox's,
 * checked against authored declarations only (never the browser's own
 * styles), and `var()` references to custom properties that are not set.
 */

import type { Declaration, Resolution } from '@/runtime/dom/inspectCascade.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import { unsetVariables } from '@/runtime/dom/inspectVariables.js';
import { findSimilarNames } from '@/utils/suggestions.js';

/** A declaration that has no effect */
export interface CssHint {
  kind: 'inactive' | 'unset-variable' | 'not-inherited';
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
  /** The element is a form control (input, textarea, select, button) */
  formControl?: boolean;
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
        ? {
            reason: 'position is static',
            fix: 'use position: absolute (out of the flow) or relative (shifted in place)',
          }
        : undefined,
  },
  {
    properties: ['z-index'],
    inactive: ({ style, parentStyle }) =>
      (style['position'] ?? 'static') === 'static' && !isFlexOrGrid(display(parentStyle))
        ? {
            reason: 'position is static',
            fix: 'use position: relative, or absolute to take it out of the flow',
          }
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
        kind: 'inactive' as const,
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
      kind: 'unset-variable',
      property: written,
      value,
      reason: `${missing.join(', ')} is not set`,
      fix: variableFix(missing[0] ?? '', style),
      declaration,
    });
  }
  return hints;
}

/**
 * How to fix a `var()` of an unset custom property, naming a similar one
 * that is set (a typo or a renamed token).
 *
 * @param name - The unset custom property
 * @param style - Computed styles (custom properties included)
 * @returns Fix
 */
function variableFix(name: string, style: StyleMap): string {
  const defined = Object.keys(style).filter((key) => key.startsWith('--'));
  const [similar] = findSimilarNames(name, defined);
  const fix = `define ${name} or give var() a fallback`;
  return similar ? `${fix} (did you mean ${similar}? it is set)` : fix;
}

/**
 * A form control drawn in the browser's font while its parent uses another:
 * controls do not inherit the font unless told to (a common oversight).
 *
 * @param cascade - Resolved properties
 * @param ctx - Computed styles of the element and its parent
 * @returns The hint, when the browser's own font-family wins
 */
export function formControlFontHints(
  cascade: Map<string, Resolution>,
  ctx: HintContext
): CssHint[] {
  const declaration = cascade.get('font-family')?.winner;
  if (!ctx.formControl || declaration?.source.origin !== 'user-agent') return [];
  const own = firstFamily(ctx.style['font-family']);
  const parent = firstFamily(ctx.parentStyle?.['font-family']);
  if (!own || !parent || own.toLowerCase() === parent.toLowerCase()) return [];
  return [
    {
      kind: 'not-inherited',
      property: 'font-family',
      value: own,
      reason: `form controls do not inherit the font (the parent uses ${parent})`,
      fix: 'add font: inherit (or font-family: inherit) to the control',
      declaration,
    },
  ];
}

/**
 * The first family of a font-family list, unquoted.
 *
 * @param value - font-family value
 * @returns First family, or undefined
 */
function firstFamily(value: string | undefined): string | undefined {
  const family = value
    ?.split(',')[0]
    ?.trim()
    .replace(/^["']|["']$/g, '');
  return family === '' ? undefined : family;
}
