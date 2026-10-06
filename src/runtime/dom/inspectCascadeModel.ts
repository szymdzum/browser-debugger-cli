/**
 * `dom inspect`'s cascade fields from the matched rules: hints (declarations
 * that have no effect), `--rules` (which declaration sets each shown
 * property, sides set by one declaration merged into the shorthand) and
 * `--why` (every declaration of one property).
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type {
  InspectHint,
  InspectResult,
  InspectRule,
  InspectWhy,
} from '@/ipc/protocol/inspectTypes.js';
import type { InactiveRule } from '@/runtime/dom/inspectScripts.js';
import { collapsedValue, normalizeProperty } from '@/runtime/dom/inspectAllStyles.js';
import {
  physicalName,
  ownProperties,
  ruleField,
  resolveCascade,
  shorthandLonghands,
  type Declaration,
  type Resolution,
} from '@/runtime/dom/inspectCascade.js';
import {
  formControlFontHints,
  inactiveHints,
  undefinedVariableHints,
  type CssHint,
} from '@/runtime/dom/inspectHints.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import { buildWhy } from '@/runtime/dom/inspectWhyModel.js';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
const sides = (pattern: string): string[] => SIDES.map((side) => pattern.replace('{side}', side));

/** Longhands reported together, so a shorthand can stand for its sides */
export interface PropertyGroup {
  shorthand?: string;
  longhands: string[];
}

/** Properties `--rules` reports */
const RULE_GROUPS: readonly PropertyGroup[] = [
  { longhands: ['display'] },
  { longhands: ['position'] },
  { shorthand: 'inset', longhands: sides('{side}') },
  { longhands: ['z-index'] },
  { longhands: ['width'] },
  { longhands: ['height'] },
  { longhands: ['min-width'] },
  { longhands: ['max-width'] },
  { longhands: ['min-height'] },
  { longhands: ['max-height'] },
  { shorthand: 'margin', longhands: sides('margin-{side}') },
  { shorthand: 'padding', longhands: sides('padding-{side}') },
  { shorthand: 'border-width', longhands: sides('border-{side}-width') },
  { shorthand: 'border-style', longhands: sides('border-{side}-style') },
  { shorthand: 'border-color', longhands: sides('border-{side}-color') },
  {
    shorthand: 'border-radius',
    longhands: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
      (c) => `border-${c}-radius`
    ),
  },
  { longhands: ['background-color'] },
  { longhands: ['background-image'] },
  { longhands: ['background-size'] },
  {
    shorthand: 'background-position',
    longhands: ['background-position-x', 'background-position-y'],
  },
  { longhands: ['color'] },
  { longhands: ['font-family'] },
  { longhands: ['font-size'] },
  { longhands: ['font-weight'] },
  { longhands: ['line-height'] },
  { longhands: ['letter-spacing'] },
  { longhands: ['text-align'] },
  { longhands: ['text-transform'] },
  { longhands: ['opacity'] },
  { longhands: ['box-shadow'] },
  { longhands: ['transform'] },
  { longhands: ['flex-direction'] },
  { longhands: ['flex-wrap'] },
  { longhands: ['justify-content'] },
  { longhands: ['align-items'] },
  { shorthand: 'gap', longhands: ['row-gap', 'column-gap'] },
  { longhands: ['grid-template-columns'] },
  { longhands: ['grid-template-rows'] },
  { shorthand: 'flex', longhands: ['flex-grow', 'flex-shrink', 'flex-basis'] },
  { longhands: ['align-self'] },
  { shorthand: 'overflow', longhands: ['overflow-x', 'overflow-y'] },
  { longhands: ['cursor'] },
];

/** What the cascade fields are built from */
export interface CascadeInput {
  matched: Protocol.CSS.GetMatchedStylesForNodeResponse;
  style: StyleMap;
  parentStyle: StyleMap | undefined;
  replaced: boolean;
  /** Where a declaration comes from, for people */
  label: (declaration: Declaration) => string;
  rules?: boolean;
  why?: string;
  /** `--props` names: `--rules` then covers only these */
  props?: string[];
  /** Longhands of the `--why` shorthand as the browser expands it */
  whyLonghands?: string[];
  /** Computed value of the `--why` shorthand, as the page writes it */
  whyComputed?: string;
  /** Rules that set the `--why` property under a condition that does not apply now */
  whyInactive?: InactiveRule[];
  /** Check for declarations that have no effect (default true) */
  hints?: boolean;
  /** A form control that draws text (its font is checked against the parent's) */
  formControl?: boolean;
}

/**
 * The cascade fields of the result.
 *
 * @param input - Matched rules, computed styles, options
 * @returns `hints` (empty when checked and nothing found), `rules` and `why`
 */
export function buildCascadeFields(input: CascadeInput): Partial<InspectResult> {
  const ruleGroups = input.rules
    ? (input.props?.map((name) => propertyGroup(name)) ?? RULE_GROUPS)
    : [];
  const whyGroup = input.why ? propertyGroup(input.why, input.whyLonghands) : undefined;
  const wanted = [
    ...new Set([
      ...ownProperties(input.matched),
      ...ruleGroups.flatMap((group) => group.longhands),
      ...(whyGroup?.longhands ?? []),
    ]),
  ];
  const cascade = resolveCascade(input.matched, wanted);
  const found = collectHints(cascade, input);
  const hints = input.hints === false ? undefined : found.map((hint) => toInspectHint(hint, input));
  const rules = buildRules(ruleGroups, cascade, input);
  return {
    ...(hints && { hints }),
    ...(rules.length > 0 && { rules }),
    ...(whyGroup && { why: withInactive(buildWhy(whyGroup, cascade, input, found), input) }),
  };
}

/**
 * The longhands a property name stands for.
 *
 * @param name - Shorthand, longhand, logical or custom property
 * @param expanded - Its longhands as the browser expands it, for a
 *   shorthand bdg does not list (`transition`, `grid-template`)
 * @returns Group (a shorthand with its longhands, or one physical longhand)
 */
function propertyGroup(name: string, expanded?: readonly string[]): PropertyGroup {
  const longhands =
    shorthandLonghands(name) ?? (expanded && [...new Set(expanded.map(physicalName))]);
  return longhands
    ? { shorthand: name, longhands: [...longhands] }
    : { longhands: [physicalName(name)] };
}

/**
 * The `--why` answer with the rules that would set the property under a
 * condition that does not apply now (on its first entry).
 *
 * @param whys - `--why` entries
 * @param input - Page-side findings
 * @returns Entries
 */
function withInactive(whys: InspectWhy[], input: CascadeInput): InspectWhy[] {
  const [first, ...rest] = whys;
  if (!first || !input.whyInactive?.length) return whys;
  return [{ ...first, inactive: input.whyInactive }, ...rest];
}

/**
 * Hints: declarations with no effect, and var() of unset custom properties;
 * none without the computed style to check them against.
 *
 * @param cascade - Resolved properties
 * @param input - Styles
 * @returns Hints with their declarations
 */
function collectHints(cascade: Map<string, Resolution>, input: CascadeInput): CssHint[] {
  if (input.style['display'] === undefined) return [];
  const declaredDisplay = cascade.get('display')?.winner?.value;
  const ctx = {
    style: input.style,
    parentStyle: input.parentStyle,
    declaredDisplay: declaredDisplay === input.style['display'] ? undefined : declaredDisplay,
    replaced: input.replaced,
    formControl: input.formControl === true,
  };
  return [
    ...inactiveHints(cascade, ctx),
    ...undefinedVariableHints(cascade, input.style),
    ...formControlFontHints(cascade, ctx),
  ];
}

/**
 * A hint as the result shows it, with where its declaration is.
 *
 * @param hint - Hint
 * @param input - The label function
 * @returns Result hint
 */
function toInspectHint(hint: CssHint, input: CascadeInput): InspectHint {
  return {
    kind: hint.kind,
    property: hint.property,
    value: hint.value,
    reason: hint.reason,
    fix: hint.fix,
    ...(hint.only && { only: hint.only }),
    ...(hint.variables && { variables: hint.variables }),
    source: input.label(hint.declaration),
  };
}

/**
 * `--rules`: one row per property set by an author declaration; one row for
 * a group (`padding`, `border-width`) when a single declaration sets all of
 * it, and one for a shorthand Chrome could not expand (`var()`, such as
 * `border: 2px solid var(--c)` or `background: var(--bg)`) however many
 * properties it sets.
 *
 * @param groups - Properties to report
 * @param cascade - Resolved properties
 * @param input - Computed style and the label function
 * @returns Rules
 */
function buildRules(
  groups: readonly PropertyGroup[],
  cascade: Map<string, Resolution>,
  input: CascadeInput
): InspectRule[] {
  const rows = groups.flatMap((group) => {
    const resolutions = group.longhands.map((longhand) => cascade.get(longhand));
    const winners = resolutions.map((resolution) => resolution?.winner);
    const grouped = group.shorthand !== undefined ? groupedRow(winners) : undefined;
    if (grouped) {
      return [toRule(grouped.property, grouped, resolutions[0], input, group.longhands)];
    }
    return group.longhands.flatMap((longhand, i) => {
      const winner = winners[i];
      if (!winner || (winner.source.origin === 'user-agent' && !input.props)) return [];
      const unexpanded = winner.via !== undefined && winner.value === winner.written;
      return unexpanded && winner.via
        ? [toRule(winner.via, winner, resolutions[i], input, [longhand])]
        : [toRule(longhand, winner, resolutions[i], input)];
    });
  });
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.property}|${row.value}|${row.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One row for a group of longhands that a single author declaration sets:
 * that declaration as written (`padding: 4px 8px`; a wider shorthand like
 * `border: none` once, not once per `border-width`/`-style`/`-color` group).
 *
 * @param winners - Winning declaration of each longhand
 * @returns The row's declaration, or undefined when the sides differ in source
 */
function groupedRow(winners: Array<Declaration | undefined>): Declaration | undefined {
  const [first] = winners;
  if (!first?.via || first.source.origin === 'user-agent') return undefined;
  const same = winners.every((w) => w && w.via === first.via && sameSource(w, first));
  if (!same) return undefined;
  return { ...first, property: first.via, value: first.written ?? first.value };
}

/**
 * Whether two declarations come from the same place.
 *
 * @param a - Declaration
 * @param b - Declaration
 * @returns True for the same declaration (same rule and position)
 */
function sameSource(a: Declaration, b: Declaration): boolean {
  return (
    a.source.kind === b.source.kind &&
    a.source.selector === b.source.selector &&
    a.source.styleSheetId === b.source.styleSheetId &&
    a.source.line === b.source.line &&
    a.source.column === b.source.column
  );
}

/**
 * The computed value of a row shown as a shorthand or logical property,
 * from its longhands: as `--all` writes it (`padding 4 8`), else the
 * longhands' values (one when they are equal).
 *
 * @param property - Shorthand or logical property
 * @param longhands - Its longhands
 * @param style - Computed longhands
 * @returns Value, or undefined when no longhand has one
 */
function shorthandValue(
  property: string,
  longhands: readonly string[],
  style: StyleMap
): string | undefined {
  const collapsed = collapsedValue(property, style);
  if (collapsed !== undefined) return collapsed;
  const values = longhands.map((longhand) => style[longhand]);
  if (values.some((value) => value === undefined)) return undefined;
  return new Set(values).size === 1 ? values[0] : values.join(' ');
}

/**
 * A `--rules` row.
 *
 * @param property - Property shown
 * @param winner - Winning declaration
 * @param resolution - Its resolution (for what it overrides)
 * @param input - Computed style and the label function
 * @param longhands - The longhands the row stands for (a shorthand's value comes from them)
 * @returns Rule
 */
function toRule(
  property: string,
  winner: Declaration,
  resolution: Resolution | undefined,
  input: CascadeInput,
  longhands: readonly string[] = [property]
): InspectRule {
  const computed = input.style[property] ?? shorthandValue(property, longhands, input.style);
  const overrides = [
    ...new Set(
      (resolution?.overridden ?? [])
        .filter((d) => d.source.origin !== 'user-agent')
        .map((d) =>
          d.source.selector !== undefined && d.source.selector === winner.source.selector
            ? input.label(d)
            : (d.source.selector ?? d.source.kind)
        )
    ),
  ];
  return {
    property,
    value: winner.value,
    ...(winner.value.includes('var(') &&
      computed !== undefined && { computed: normalizeProperty(property, computed) }),
    ...(property === 'display' &&
      computed !== undefined &&
      computed !== winner.value &&
      /^(inline|table-|ruby)/.test(winner.value) && { computed: `${computed} (blockified)` }),
    source: input.label(winner),
    ...ruleField(winner),
    ...(overrides.length > 0 && { overrides }),
    ...(winner.ancestor !== undefined && { inherited: winner.ancestor }),
    ...(winner.important && { important: true as const }),
    ...(winner.source.layer && { layer: winner.source.layer }),
    ...(winner.source.condition && { condition: winner.source.condition }),
  };
}
