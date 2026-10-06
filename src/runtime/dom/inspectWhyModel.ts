/**
 * `dom inspect --why <property>`: every declaration of a property on the
 * element, the winner first, with `var()` values substituted and where the
 * winner's custom properties are set. A shorthand gives one answer when one
 * declaration sets all its longhands (listing every declaration it beats on
 * any of them), else one per longhand.
 */

import type { InspectVariable, InspectWhy, InspectWhyEntry } from '@/ipc/protocol/inspectTypes.js';
import { collapsedValue, normalizeProperty } from '@/runtime/dom/inspectAllStyles.js';
import {
  isInherited,
  resolveCascade,
  ruleField,
  type Declaration,
  type Resolution,
} from '@/runtime/dom/inspectCascade.js';
import type { CascadeInput, PropertyGroup } from '@/runtime/dom/inspectCascadeModel.js';
import type { CssHint } from '@/runtime/dom/inspectHints.js';
import {
  substituteVariables,
  unsetVariables,
  usedVariables,
} from '@/runtime/dom/inspectVariables.js';

/**
 * `--why` for a property.
 *
 * @param group - The property and its longhands
 * @param cascade - Resolved properties
 * @param input - Matched rules, computed style and the label function
 * @returns One entry, or one per longhand when they differ
 */
export function buildWhy(
  group: PropertyGroup,
  cascade: Map<string, Resolution>,
  input: CascadeInput,
  hints: readonly CssHint[] = []
): InspectWhy[] {
  const whys = group.longhands.map((longhand) =>
    whyOf(longhand, cascade.get(longhand), input, hints)
  );
  const [first] = whys;
  if (!first || group.shorthand === undefined) return whys;
  const winner = JSON.stringify(first.chain[0]);
  if (!whys.every((why) => JSON.stringify(why.chain[0]) === winner)) return whys;
  const values = whys.map((why) => why.computed);
  const joined = values.every((value) => value === first.computed)
    ? first.computed
    : values.join(' ');
  const fromPage = input.whyComputed
    ? normalizeProperty(group.shorthand, input.whyComputed)
    : undefined;
  const computed = collapsedValue(group.shorthand, input.style) ?? fromPage ?? joined;
  const beaten = whys.flatMap((why) => why.chain.slice(1));
  const overridden = [...new Map(beaten.map((entry) => [JSON.stringify(entry), entry])).values()];
  const chain = [...first.chain.slice(0, 1), ...overridden];
  return [{ ...first, property: group.shorthand, computed, chain }];
}

/**
 * `--why` for one longhand.
 *
 * @param property - Longhand
 * @param resolution - Its resolution
 * @param input - Matched rules, computed style and the label function
 * @param hints - Hints, for a winner that has no effect
 * @returns Why
 */
function whyOf(
  property: string,
  resolution: Resolution | undefined,
  input: CascadeInput,
  hints: readonly CssHint[]
): InspectWhy {
  const winner = resolution?.winner;
  const status = winner?.ancestor !== undefined ? 'inherited' : 'applied';
  const chain = [
    ...(winner ? [withNote(whyEntry(winner, status, input), winner, property, hints)] : []),
    ...(resolution?.overridden ?? []).map((d) => whyEntry(d, 'overridden', input)),
  ];
  const variables = winner ? variableSources(winner, input) : [];
  return {
    property,
    computed: normalizeProperty(property, input.style[property] ?? ''),
    chain,
    ...(variables.length > 0 && { variables }),
  };
}

/**
 * One declaration in a `--why` chain: a shorthand's as written, `var()`
 * substituted (or the custom properties that are not set), with the
 * selector's specificity.
 *
 * @param declaration - Declaration
 * @param status - Applied, overridden or inherited
 * @param input - Computed style and the label function
 * @returns Entry
 */
function whyEntry(
  declaration: Declaration,
  status: InspectWhyEntry['status'],
  input: CascadeInput
): InspectWhyEntry {
  const written = declaration.via ? (declaration.written ?? declaration.value) : declaration.value;
  const value =
    written === ''
      ? `${input.style[declaration.property] ?? ''} (set by the browser)`.trim()
      : written;
  const unset = value.includes('var(') ? unsetVariables(value, input.style) : [];
  const resolved = value.includes('var(') ? resolvedValue(declaration, value, input) : value;
  const { specificity, layer, condition } = declaration.source;
  return {
    value,
    ...(declaration.via && { via: declaration.via }),
    ...(unset.length > 0 ? { unset } : resolved !== value && { resolved }),
    source: input.label(declaration),
    ...ruleField(declaration),
    ...(specificity && { specificity }),
    status,
    ...(declaration.important && { important: true as const }),
    ...(layer && { layer }),
    ...(condition && { condition }),
  };
}

/**
 * The winner's entry with why it changes nothing: the hint that says it has
 * no effect, or what applies instead of an invalid `var()`.
 *
 * @param entry - Winner's entry
 * @param winner - Winning declaration
 * @param property - Longhand
 * @param hints - Hints
 * @returns Entry, with `note` when there is one
 */
function withNote(
  entry: InspectWhyEntry,
  winner: Declaration,
  property: string,
  hints: readonly CssHint[]
): InspectWhyEntry {
  if (entry.unset) {
    const fallback = isInherited(property) ? 'the inherited value' : 'the initial value';
    return { ...entry, note: `falls back to ${fallback}` };
  }
  const inactive = hints.find(
    (hint) =>
      hint.kind === 'inactive' &&
      sameDeclaration(hint.declaration, winner) &&
      (hint.only?.includes(property) ?? true)
  );
  return inactive ? { ...entry, note: `no effect: ${inactive.reason}` } : entry;
}

/**
 * Whether two longhand declarations come from the same declaration as written.
 *
 * @param a - Declaration
 * @param b - Declaration
 * @returns True for the same place and property
 */
function sameDeclaration(a: Declaration, b: Declaration): boolean {
  return (
    a.source.kind === b.source.kind &&
    a.source.styleSheetId === b.source.styleSheetId &&
    a.source.line === b.source.line &&
    a.source.column === b.source.column &&
    (a.via ?? a.property) === (b.via ?? b.property)
  );
}

/** How many levels of custom properties set from others are followed */
const MAX_VARIABLE_DEPTH = 5;

/**
 * Where the custom properties the winning value uses are set, and those
 * their values use in turn (`--bs-btn-border-width: var(--bs-border-width)`).
 *
 * @param winner - Winning declaration
 * @param input - Matched rules, computed style and the label function
 * @returns The variables with a declaration (on the element or an ancestor)
 */
function variableSources(winner: Declaration, input: CascadeInput): InspectVariable[] {
  const found: InspectVariable[] = [];
  let names = usedVariables(winner.written ?? winner.value, input.style);
  for (let depth = 0; names.length > 0 && depth < MAX_VARIABLE_DEPTH; depth++) {
    const cascade = resolveCascade(input.matched, names);
    const next = names.flatMap((name) => {
      const declaration = cascade.get(name)?.winner;
      if (!declaration || found.some((variable) => variable.name === name)) return [];
      found.push({
        name,
        value: declaration.value,
        source: input.label(declaration),
        ...(declaration.ancestor !== undefined && { inherited: declaration.ancestor }),
      });
      return usedVariables(declaration.value, input.style);
    });
    names = [...new Set(next)];
  }
  return found;
}

/**
 * A `var()` value substituted; a color longhand's in hex (Tailwind's
 * `lab()` and `oklch()` tokens are unreadable).
 *
 * @param declaration - Declaration
 * @param value - Its value as shown
 * @param input - Computed style
 * @returns Substituted value
 */
function resolvedValue(declaration: Declaration, value: string, input: CascadeInput): string {
  const substituted = substituteVariables(value, input.style);
  const isColor = declaration.via === undefined && declaration.property.endsWith('color');
  return isColor && !substituted.includes('var(')
    ? normalizeProperty(declaration.property, substituted)
    : substituted;
}
