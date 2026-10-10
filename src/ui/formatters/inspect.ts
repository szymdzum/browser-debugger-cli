/**
 * Human output of `bdg dom inspect`: a header line, then one line per group
 * in Figma's order with DevTools' names (box, layout, parent, text, fill,
 * border, fx, state, pseudo), then the child tree. Fields within a line are
 * separated by ` · `; lengths are CSS px without the unit.
 *
 * ```
 * button#buy.btn "Buy now" 120x41 @20,20 [flex] [prefers light]
 * box    p 12 24 · b 1
 * layout inline-flex row · gap 8
 * parent div.card flex column · gap 16 · in-parent l0 t0 r180 b0 · sib b16
 * text   Inter (webfont) 600 16/24 · color #fff · contrast 5.17 AA
 * fill   bg #1c69e3
 * border 1 solid #32447f · radius 8
 * ```
 */

import type {
  InspectContrast,
  InspectBox,
  InspectContainer,
  InspectFill,
  InspectLayout,
  InspectParent,
  InspectPseudo,
  InspectResult,
  InspectRule,
  InspectText,
  InspectTreeNode,
  InspectWhy,
} from '@/ipc/protocol/inspectTypes.js';
import { containerKind } from '@/runtime/dom/inspectLayoutModel.js';
import type { IndexSource } from '@/types.js';
import { joinLines } from '@/ui/formatting.js';
import {
  inspectCascadeNote,
  inspectClosedShadowRootLine,
  inspectAnimatingBadge,
  inspectMidTransitionNote,
  inspectDarkThemeBadge,
  inspectPseudoOfNote,
  inspectedMatchAction,
  inspectVisibilityBadges,
  multipleMatchesWarning,
} from '@/ui/messages/commands.js';
import { shadowText, sidesShorthand, type CssLength } from '@/utils/cssValues.js';
import { truncateByLength } from '@/utils/strings.js';

/** Longest parent label on the parent line (CSS-module class names run long) */
const PARENT_LABEL_MAX = 40;

/** `bdg dom inspect` data (the `success` flag is implied by the envelope), with the list an index refers to */
export type InspectOutput = Omit<InspectResult, 'success'> & {
  indexSource?: IndexSource | undefined;
};

/** Width of the group label column */
const LABEL_WIDTH = 7;

/** Width a `--all` line wraps at */
const ALL_LINE_WIDTH = 100;

/**
 * One group line: the label, then its fields joined with ` · `.
 *
 * @param label - Group name
 * @param parts - Fields (empty ones left out)
 * @returns The line, or undefined when there are no fields
 */
function groupLine(label: string, parts: Array<string | false | undefined>): string | undefined {
  const shown = parts.filter((part): part is string => Boolean(part));
  return shown.length > 0 ? `${label.padEnd(LABEL_WIDTH)}${shown.join(' · ')}` : undefined;
}

/**
 * The header: label, text, size and position, layout badge, what keeps it
 * from being seen, where it lives and the color scheme.
 *
 * @param data - Inspect result
 * @returns Header line
 */
export function inspectHeader(data: InspectOutput): string {
  const display = data.layout?.display ?? data.all?.['display'];
  const kind = containerKind(display);
  return [
    data.element,
    data.content !== undefined && `"${data.content}"`,
    data.placeholder !== undefined && `placeholder "${data.placeholder}"`,
    data.rect &&
      `${data.rect.w}x${data.rect.h}${data.rect.screen ? ` (${data.rect.screen.w}x${data.rect.screen.h} on screen)` : ''} @${data.rect.x},${data.rect.y}${data.rect.in ? ' (fixed: viewport position)' : ''}`,
    kind && `[${kind}]`,
    ...inspectVisibilityBadges(data.visibility),
    data.context && `in ${data.context}`,
    data.theme === 'dark' && inspectDarkThemeBadge(data.themeFrom === 'emulation'),
    data.animating && inspectAnimatingBadge(data.animating),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Whether all four sides are 0.
 *
 * @param sides - Sides
 * @returns True when nothing is set
 */
function zero(sides: readonly CssLength[]): boolean {
  return sides.every((side) => side === 0);
}

/**
 * Min/max size limits, e.g. `min-w 100`.
 *
 * @param kind - `min` or `max`
 * @param limits - Width and height limits
 * @returns Fields
 */
function limitParts(kind: string, limits: InspectBox['min']): string[] {
  if (!limits) return [];
  return [
    limits.w !== undefined ? `${kind}-w ${limits.w}` : '',
    limits.h !== undefined ? `${kind}-h ${limits.h}` : '',
  ].filter(Boolean);
}

/**
 * The box line: margin, padding, border widths (when not all 0), content-box
 * sizing (when padding or border make the box larger than its CSS size),
 * size limits, overflow and the scroll size.
 *
 * @param box - Box group
 * @returns Line
 */
function boxLine(box: InspectBox): string | undefined {
  const padded = !zero(box.padding) || !zero(box.border);
  return groupLine('box', [
    !zero(box.margin) && `m ${sidesShorthand(box.margin)}`,
    !zero(box.padding) && `p ${sidesShorthand(box.padding)}`,
    !zero(box.border) && `b ${sidesShorthand(box.border)}`,
    padded && box.sizing === 'content-box' && 'sizing content-box',
    ...limitParts('min', box.min),
    ...limitParts('max', box.max),
    box.overflow && `overflow ${box.overflow}`,
    box.scroll && `scroll ${box.scroll.w}x${box.scroll.h}`,
  ]);
}

/**
 * Container fields as words, e.g. `wrap wrap`, `cols repeat(3,100)`, `gap 16`.
 *
 * @param container - Container fields
 * @returns Fields
 */
function containerParts(container: InspectContainer): string[] {
  const gap = Array.isArray(container.gap) ? container.gap.join(' ') : container.gap;
  return [
    container.wrap && `wrap ${container.wrap}`,
    container.columns && `cols ${container.columns}`,
    container.rows && `rows ${container.rows}`,
    container.justify && `justify ${container.justify}`,
    container.align && `align ${container.align}`,
    gap !== undefined && `gap ${gap}`,
  ].filter((part): part is string => Boolean(part));
}

/**
 * Display with the flex direction, e.g. `flex column`.
 *
 * @param display - Display
 * @param direction - Flex direction
 * @returns Words
 */
function displayWords(display: string, direction: string | undefined): string {
  return direction ? `${display} ${direction}` : display;
}

/**
 * The layout line: display, position, container and item fields.
 *
 * @param layout - Layout group
 * @returns Line
 */
function layoutLine(layout: InspectLayout): string | undefined {
  return groupLine('layout', [
    displayWords(layout.display, layout.direction),
    layout.position && `position ${layout.position}`,
    layout.inset && `inset ${sidesShorthand(layout.inset)}`,
    layout.z !== undefined && `z ${layout.z}`,
    ...containerParts(layout),
    layout.flex && `flex ${layout.flex}`,
    layout.self && `self ${layout.self}`,
    layout.order !== undefined && `order ${layout.order}`,
    layout.area && `area ${layout.area}`,
    layout.valign && `valign ${layout.valign}`,
    layout.float && `float ${layout.float}`,
  ]);
}

/**
 * The parent line: the parent's label, display and layout, then the
 * element's offsets from its content edges and the gaps to its siblings.
 *
 * @param layout - Layout group
 * @returns Line
 */
function parentLine(layout: InspectLayout): string | undefined {
  const parent: InspectParent | undefined = layout.parent;
  const offsets = layout.inParent;
  const gaps = Object.entries(layout.siblings ?? {}).map(([side, gap]) => `${side[0]}${gap}`);
  const parentWords = parent && [
    truncateByLength(parent.element, PARENT_LABEL_MAX),
    displayWords(parent.display, parent.direction),
    ...containerParts(parent),
    parent.textAlign && `text-align ${parent.textAlign}`,
  ];
  return groupLine('parent', [
    parentWords?.filter(Boolean).join(' '),
    offsets && `in-parent l${offsets.left} t${offsets.top} r${offsets.right} b${offsets.bottom}`,
    gaps.length > 0 && `sib ${gaps.join(' ')}`,
  ]);
}

/**
 * Font, weight and size as one phrase, e.g. `Inter (webfont) 600 italic 16/24`,
 * `Inter (rendered "Helvetica") 400 14/normal` when the text was drawn in a
 * fallback, or `sans-serif (resolves to "Helvetica")`; for a container only
 * the fields it has.
 *
 * @param text - Text group
 * @returns Fields
 */
function fontParts(text: InspectText): string[] {
  const loaded = [
    text.rendered && `rendered "${text.rendered}"`,
    text.resolved && `resolves to "${text.resolved}"`,
    text.webfont && 'webfont loaded',
  ].filter(Boolean);
  const family = text.family && [text.family, loaded.length > 0 && `(${loaded.join(', ')})`];
  const size =
    text.size !== undefined &&
    (text.lineHeight !== undefined ? `${text.size}/${text.lineHeight}` : `${text.size}`);
  if (family && text.weight !== undefined && size) {
    return [
      [...family, text.weight, text.style, size]
        .filter((part) => part !== undefined && part !== false && part !== '')
        .join(' '),
    ];
  }
  return [
    family && `font ${family.filter(Boolean).join(' ')}`,
    text.weight !== undefined && `weight ${text.weight}`,
    text.style && `style ${text.style}`,
    size && `size ${size}`,
    !size && text.lineHeight !== undefined && `line-height ${text.lineHeight}`,
  ].filter((part): part is string => Boolean(part));
}

/**
 * A contrast as words, e.g. `contrast 4.47 fail on #fff (faded: opacity 0.4)`.
 * An approximate one gets no pass/fail level, only the estimate and why
 * (`contrast ≈1 on #fff (approximate: img.hero behind)`): what is behind
 * the text is not a known color.
 *
 * @param contrast - Contrast
 * @returns Words, or undefined
 */
function contrastText(contrast: InspectContrast | undefined): string | undefined {
  if (!contrast) return undefined;
  return [
    contrast.approximate
      ? `contrast ≈${contrast.ratio}`
      : `contrast ${contrast.ratio} ${contrast.level}`,
    `on ${contrast.background}`,
    contrast.opacity !== undefined && `(faded: opacity ${contrast.opacity})`,
    contrast.approximate && `(approximate: ${contrast.approximate.join(', ')})`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The text line: font, color, contrast and the non-default extras.
 *
 * @param text - Text group
 * @returns Line
 */
function textLine(text: InspectText): string | undefined {
  return groupLine('text', [
    text.holder && `in ${text.holder}`,
    ...fontParts(text),
    text.color && `color ${text.color}`,
    contrastText(text.contrast),
    text.align && `align ${text.align}`,
    text.transform && `transform ${text.transform}`,
    text.tracking !== undefined && `tracking ${text.tracking}`,
    text.decoration && `decoration ${text.decoration}`,
    text.whiteSpace && `ws ${text.whiteSpace}`,
    text.overflow && `text-overflow ${text.overflow}`,
    text.clamp && `clamp ${text.clamp}`,
    text.truncated && 'truncated',
    text.gradientFill && 'filled by its background (background-clip: text; no contrast)',
    text.shadow && `shadow ${text.shadow}`,
    text.features && `features ${text.features}`,
  ]);
}

/**
 * A fill as words.
 *
 * @param fill - Fill
 * @returns e.g. `bg #fff`, `bg-image url(hero.png) size cover`
 */
function fillText(fill: InspectFill): string {
  if (fill.type === 'solid') return `bg ${fill.color}`;
  return [
    `bg-image ${fill.value}`,
    fill.size && `size ${fill.size}`,
    fill.position && `at ${fill.position}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The fill line: backgrounds (and that they are clipped to gradient text), opacity and blend mode.
 *
 * @param data - Inspect result
 * @returns Line
 */
function fillLine(data: InspectOutput): string | undefined {
  const paint = data.paint;
  return groupLine('fill', [
    paint && `fill ${paint.fill}`,
    paint &&
      `stroke ${paint.stroke}${paint.strokeWidth !== undefined ? ` ${paint.strokeWidth}` : ''}`,
    ...(data.fills ?? []).map(fillText),
    data.text?.gradientFill &&
      !data.text.holder &&
      (data.fills ?? []).length > 0 &&
      'clipped to the text',
    data.opacity !== undefined && `opacity ${data.opacity}`,
    data.blend && `blend ${data.blend}`,
  ]);
}

/**
 * The border line: strokes, radius and outline.
 *
 * @param data - Inspect result
 * @returns Line
 */
function borderLine(data: InspectOutput): string | undefined {
  const outline = data.outline;
  return groupLine('border', [
    ...(data.strokes ?? []).map(
      (s) => `${s.side === 'all' ? '' : `${s.side} `}${s.width} ${s.style} ${s.color}`
    ),
    data.radius && `radius ${sidesShorthand(data.radius)}`,
    outline &&
      `outline ${outline.width} ${outline.style} ${outline.color}${outline.offset ? ` offset ${outline.offset}` : ''}`,
  ]);
}

/**
 * The fx line: shadows, transform, filters, clip, mask and animation.
 *
 * @param data - Inspect result
 * @returns Line
 */
function fxLine(data: InspectOutput): string | undefined {
  const shadows = (data.effects ?? []).map((e) =>
    shadowText({ ...e, inset: e.type === 'inner-shadow' })
  );
  const fx = data.fx ?? {};
  return groupLine('fx', [
    shadows.length > 0 && `shadow ${shadows.join(', ')}`,
    fx.transform && `transform ${fx.transform}`,
    fx.filter && `filter ${fx.filter}`,
    fx.backdrop && `backdrop ${fx.backdrop}`,
    fx.clip && `clip ${fx.clip}`,
    fx.mask && `mask ${fx.mask}`,
    fx.animation && `animation ${fx.animation}`,
  ]);
}

/**
 * The state line.
 *
 * @param data - Inspect result
 * @returns Line
 */
function stateLine(data: InspectOutput): string | undefined {
  const state = data.state ?? {};
  return groupLine('state', [
    state.cursor && `cursor ${state.cursor}`,
    state.pointerEvents && `pointer-events ${state.pointerEvents}`,
    state.visibility && `visibility ${state.visibility}`,
    state.userSelect && `select ${state.userSelect}`,
    state.appearance && `appearance ${state.appearance}`,
  ]);
}

/**
 * One pseudo-element as words.
 *
 * @param pseudo - Pseudo-element
 * @returns e.g. `::before content "★" absolute 25x15 color #f00`
 */
function pseudoText(pseudo: InspectPseudo): string {
  const shadows = (pseudo.effects ?? []).map((e) =>
    shadowText({ ...e, inset: e.type === 'inner-shadow' })
  );
  return [
    pseudo.type,
    pseudo.content !== undefined && `content ${pseudo.content}`,
    pseudo.display,
    pseudo.position,
    pseudo.inset && `inset ${pseudo.inset}`,
    pseudo.size && `${pseudo.size.w}x${pseudo.size.h}`,
    pseudo.color && `color ${pseudo.color}`,
    pseudo.fontStyle,
    pseudo.fontWeight !== undefined && `weight ${pseudo.fontWeight}`,
    pseudo.contrast && `· ${contrastText(pseudo.contrast)}`,
    ...(pseudo.fills ?? []).map(fillText),
    pseudo.radius && `radius ${pseudo.radius}`,
    shadows.length > 0 && `shadow ${shadows.join(', ')}`,
    pseudo.transform && `transform ${pseudo.transform}`,
    pseudo.opacity !== undefined && `opacity ${pseudo.opacity}`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Pseudo-element lines (the label on the first only).
 *
 * @param pseudo - Pseudo-elements
 * @returns Lines
 */
function pseudoLines(pseudo: readonly InspectPseudo[] | undefined): string[] {
  return (pseudo ?? []).map(
    (entry, i) => `${(i === 0 ? 'pseudo' : '').padEnd(LABEL_WIDTH)}${pseudoText(entry)}`
  );
}

/**
 * One tree row.
 *
 * @param node - Row
 * @returns e.g. `li.card ×33 266x107`, `div.card-body 286x190 [flex] (3)`
 */
function treeRow(node: InspectTreeNode): string {
  return [
    node.element,
    node.count !== undefined && `×${node.count}`,
    node.contents ? '(contents)' : `${node.w}x${node.h}`,
    node.shadow && '(shadow root)',
    node.via && `via ${node.via}`,
    node.layout && `[${node.layout}]`,
    node.text && `"${node.text}"`,
    node.childCount !== undefined && `(${node.childCount})`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Tree rows, indented by depth, with the hidden children of each level.
 *
 * @param nodes - Rows
 * @param hidden - Hidden children at this level
 * @param depth - Indentation level
 * @returns Lines
 */
function treeLines(
  nodes: readonly InspectTreeNode[],
  hidden: number | undefined,
  depth: number
): string[] {
  const indent = '  '.repeat(depth);
  const lines = nodes.flatMap((node) => [
    `${indent}${treeRow(node)}`,
    ...treeLines(node.children ?? [], node.hiddenChildren, depth + 1),
  ]);
  return hidden ? [...lines, `${indent}(+${hidden} not rendered)`] : lines;
}

/**
 * Lines under a label shown on the first only (`hints  a`, `       b`).
 *
 * @param label - Group label
 * @param lines - Lines
 * @returns Labelled lines
 */
function labelledLines(label: string, lines: string[]): string[] {
  return lines.map((line, i) => `${i === 0 ? label.padEnd(6) : ''.padEnd(6)} ${line}`);
}

/**
 * Where a rule applies when it is not always: its layer and condition.
 *
 * @param entry - Layer and media/container condition
 * @returns e.g. ` @media (min-width: 80rem) layer utilities`, or empty
 */
function ruleScope(entry: { layer?: string | undefined; condition?: string | undefined }): string {
  return [entry.condition && ` @${entry.condition}`, entry.layer && ` layer ${entry.layer}`]
    .filter(Boolean)
    .join('');
}

/**
 * Hints, `--rules` and `--why` lines, and a note when the cascade was not read in time.
 *
 * @param data - Inspect result
 * @returns Lines
 */
function cascadeBlock(data: InspectOutput): string[] {
  const hints = (data.hints ?? []).map(
    (hint) =>
      `${hint.property}: ${hint.value} ${hint.kind === 'not-inherited' ? "is the browser's" : hint.only ? `has no effect on ${hint.only.join(', ')}` : 'has no effect'}: ${hint.reason} → ${hint.fix} · in ${hint.source}`
  );
  return [
    ...labelledLines('hints', data.hints?.length === 0 ? ['none'] : hints),
    ...labelledLines('rules', (data.rules ?? []).map(ruleLine)),
    ...labelledLines(
      'why',
      (data.why ?? []).flatMap((why) => whyLines(why, data))
    ),
    ...(data.cascade ? [inspectCascadeNote(data.cascade)] : []),
  ];
}

/**
 * A `--rules` line: property, value as written (= computed for `var()`),
 * source, scope, inheritance and what it beats.
 *
 * @param rule - Rule
 * @returns Line
 */
function ruleLine(rule: InspectRule): string {
  return [
    `${rule.property} ${truncateByLength(rule.value, CASCADE_VALUE_WIDTH)}`,
    rule.computed !== undefined && ` = ${truncateByLength(rule.computed, CASCADE_VALUE_WIDTH)}`,
    `${rule.important ? ' !important' : ''} ← ${rule.source}`,
    ruleScope(rule),
    rule.inherited !== undefined && ` (inherited from ${levelsUp(rule.inherited)})`,
    rule.overrides && ` over ${rule.overrides.join(', ')}`,
  ]
    .filter(Boolean)
    .join('');
}

/**
 * `--why` lines of one property: the computed value, each declaration
 * (`✓` the winner, `✗` the ones it beats) and where the winner's custom
 * properties are set.
 *
 * @param why - Why
 * @param data - Inspect result (for running transitions)
 * @returns Lines
 */
function whyLines(why: InspectWhy, data: InspectOutput): string[] {
  const entries = why.chain.map((entry) => {
    const value = `${entry.via ? `${entry.via}: ` : ''}${entry.value}`;
    const resolved = entry.unset
      ? ` = invalid: ${entry.unset.join(', ')} not set`
      : entry.resolved !== undefined
        ? ` = ${truncateByLength(entry.resolved, CASCADE_VALUE_WIDTH)}`
        : '';
    return [
      `  ${entry.status === 'overridden' ? '✗' : '✓'} `,
      truncateByLength(value, CASCADE_VALUE_WIDTH) + resolved,
      entry.important ? ' !important' : '',
      `  ${entry.source}${entry.specificity ? ` [${entry.specificity.join(',')}]` : ''}${ruleScope(entry)}`,
      entry.status === 'inherited' ? ' (inherited)' : '',
      entry.note ? ` (${entry.note})` : '',
    ].join('');
  });
  const variables = (why.variables ?? []).map(
    (variable) =>
      `    ${variable.name}: ${truncateByLength(variable.value, CASCADE_VALUE_WIDTH)}  ${variable.source}${variable.inherited !== undefined ? ` (inherited from ${levelsUp(variable.inherited)})` : ''}`
  );
  return [
    `${why.property} = ${why.computed}${midTransition(why.property, data.animating) ? ` ${inspectMidTransitionNote()}` : ''}`,
    ...entries.slice(0, 1),
    ...(why.chain[0]?.rule
      ? [`    in ${truncateByLength(why.chain[0].rule, RULE_LINE_WIDTH)}`]
      : []),
    ...variables,
    ...entries.slice(1),
    ...(why.inactive ?? []).map(
      (rule) =>
        `  - ${truncateByLength(rule.value, CASCADE_VALUE_WIDTH)}  ${rule.selector} ${rule.condition} (does not apply now)`
    ),
    ...(why.chain.length === 0 ? ['  no author declaration: the default or inherited value'] : []),
  ];
}

/**
 * Whether a property is being transitioned (or animated) right now.
 *
 * @param property - Longhand or shorthand asked about
 * @param animating - Running transitions' properties and animations' names
 * @returns True when its value is mid-way
 */
function midTransition(property: string, animating: string[] | undefined): boolean {
  return (animating ?? []).some(
    (name) =>
      name === 'all' ||
      name === property ||
      property.startsWith(`${name}-`) ||
      name.startsWith(`${property}-`)
  );
}

/**
 * How far up the ancestor an inherited value comes from is.
 *
 * @param levels - Ancestor levels
 * @returns e.g. `the parent`, `3 levels up`
 */
function levelsUp(levels: number): string {
  return levels === 1 ? 'the parent' : `${levels} levels up`;
}

/** Longest rule text shown under the winner in `--why` (JSON has up to 300 characters) */
const RULE_LINE_WIDTH = 120;

/** Longest declared value shown in `--rules` and `--why` lines (font stacks run long) */
const CASCADE_VALUE_WIDTH = 60;

/**
 * The tree block, and for a closed shadow host a line saying where the
 * children of its shadow root are found.
 *
 * @param data - Inspect result
 * @returns Lines (none without children)
 */
function treeBlock(data: InspectOutput): string[] {
  const closed = data.shadowRootMode === 'closed' ? [inspectClosedShadowRootLine()] : [];
  if (!data.children && !data.hiddenChildren) return closed;
  return [
    'tree',
    ...treeLines(data.children ?? [], data.hiddenChildren, 1),
    ...(data.moreRows ? [`  … +${data.moreRows} more`] : []),
    ...closed,
  ];
}

/**
 * `--all` properties packed into lines of about {@link ALL_LINE_WIDTH} characters.
 *
 * @param all - Properties and values
 * @returns Lines
 */
function allLines(all: Record<string, string>): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  for (const [name, value] of Object.entries(all)) {
    current.push(`${name} ${value}`);
    if (current.join(' · ').length > ALL_LINE_WIDTH) {
      lines.push(current.join(' · '));
      current = [];
    }
  }
  if (current.length > 0) lines.push(current.join(' · '));
  return lines.map((line, i) => `${(i === 0 ? 'all' : '').padEnd(LABEL_WIDTH)}${line}`);
}

/**
 * `--props` lines: the computed value, and the normalized one when it differs;
 * a custom property no rule sets is `(not set)`.
 *
 * @param props - Properties asked for
 * @returns Lines
 */
function propLines(props: NonNullable<InspectResult['props']>): string[] {
  if (Object.keys(props).length === 0) return ['(no matching custom properties)'];
  return Object.entries(props).map(
    ([name, prop]) =>
      `${name}: ${prop.computed || (name.startsWith('--') ? '(not set)' : '(empty)')}${prop.value !== prop.computed ? ` = ${prop.value}` : ''}`
  );
}

/**
 * The style group lines.
 *
 * @param data - Inspect result
 * @returns Lines
 */
function groupLines(data: InspectOutput): Array<string | undefined> {
  return [
    data.box && boxLine(data.box),
    data.layout && layoutLine(data.layout),
    data.layout && parentLine(data.layout),
    data.text && textLine(data.text),
    fillLine(data),
    borderLine(data),
    fxLine(data),
    stateLine(data),
    ...pseudoLines(data.pseudo),
  ];
}

/**
 * Format `bdg dom inspect` output (`--why` answers only its question:
 * the header, hints and the declarations, no style groups or tree).
 *
 * @param data - Inspect result
 * @returns Formatted output
 */
export function formatInspect(data: InspectOutput): string {
  const body = data.props
    ? propLines(data.props)
    : data.all
      ? allLines(data.all)
      : groupLines(data);
  const note = data.picked
    ? multipleMatchesWarning(data.count, inspectedMatchAction(data.picked, data.index))
    : undefined;
  const pseudoNote = data.pseudoOf && inspectPseudoOfNote(data.pseudoOf);
  if (data.why) return joinLines(inspectHeader(data), ...cascadeBlock(data), note, pseudoNote);
  return joinLines(
    inspectHeader(data),
    ...body,
    ...cascadeBlock(data),
    ...treeBlock(data),
    note,
    pseudoNote
  );
}
