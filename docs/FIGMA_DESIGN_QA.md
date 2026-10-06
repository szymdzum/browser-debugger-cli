# Checking a page against a Figma design

This recipe lets an agent check a built page against a Figma frame with no screenshots:
- the [Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559) gives the design values;
- `bdg dom inspect --json` gives what the browser renders, in Figma's terms (fills, strokes, effects, Hug/Fill/Fixed);
- `--rules` names the CSS rule to change for each property that differs.

## 1. Read the design

From a Figma link such as `https://figma.com/design/<fileKey>/<name>?node-id=12-34` (node `12:34`):

| Figma MCP tool | Gives |
|---|---|
| `get_design_context` | Reference code (React + Tailwind) with the values and tokens as `var(--token, fallback)`, plus `data-node-id` and `data-name` on each layer |
| `get_variable_defs` | The tokens the node uses: `{"color/primary": "#0a7cff", "spacing/md": "16"}` |
| `get_metadata` | Each layer's id, name, type, x, y, width and height (XML) |

## 2. Read the page

Start the session at the frame's width and in the design's color scheme:

```bash
bdg https://app.example.com/checkout --viewport 1440x900 --color-scheme light
bdg dom query "button"                                  # Find the element that matches the layer
bdg dom inspect "#buy" --json --rules --tree 2          # Values, the rules that set them, children
```

- `--rules` adds each property's declaration as written (`var(--color-primary)`) with its file:line.
- `--tree 2` lists the children with their sizes and their `x`/`y` relative to the parent, as `get_metadata` does.
- To read only a few properties, use `--props padding-top,gap,color --rules`.

## 3. Match layers to elements

The hard part is matching layers to elements, not the values. Match on, in this order:

1. **Text content.** The `content` and `children[].text` fields against the layer's text.
2. **Name.** `data-name` against ids and classes (`button#buy`, `.card-title`).
3. **Position in the parent.** Child order, and `x`/`y` within ±2 px.

A `data-node-id` attribute on the page, if the code kept it from Figma, is an exact match.

## 4. Compare

| Figma | `dom inspect --json` | Notes |
|---|---|---|
| Width × height | `rect.w`, `rect.h` | Border box in CSS px. Figma's size includes its strokes inside, CSS includes borders when `box.sizing` is `border-box`. |
| Resizing Hug / Fill / Fixed | `layout.sizing.w`, `layout.sizing.h` | `hug`, `fill`, `fixed` |
| Auto layout direction | `layout.display` `flex`, `layout.direction` | Horizontal = `row`, vertical = `column` |
| Gap between items | `layout.gap` | One number, or `[row, column]` |
| Padding | `box.padding` | `[top, right, bottom, left]` |
| Primary / counter axis alignment | `layout.justify`, `layout.align` | Missing means `normal`/`stretch` |
| Layer x / y in its frame | `children[].x`, `children[].y` (from the parent's inspect) | Relative to the parent's border box |
| Spacing between frames | the parent's `layout.gap` and `box.padding`, `layout.inParent`, `layout.siblings` | Figma has no margins, so compare the space between elements, not `box.margin` |
| Fill | `fills[]` (`{type: "solid", color}`) | Lowercase hex, `#rrggbbaa` with alpha |
| Layer opacity | `opacity` | |
| Stroke | `strokes[]` (`side`, `width`, `style`, `color`), `outline` | Figma strokes are drawn over the box (inside, center or outside). CSS borders take space unless `box.sizing` is `border-box`. |
| Corner radius | `radius` | `[top-left, top-right, bottom-right, bottom-left]` |
| Drop / inner shadow | `effects[]` (`shadow`, `inner-shadow`; `x`, `y`, `blur`, `spread`, `color`) | |
| Layer blur, background blur | `fx.filter`, `fx.backdrop` | |
| Font family / style | `text.family`, `text.rendered`, `text.style` | `rendered` is the font Chrome actually used. A different font there means the design font did not load. |
| Font size, weight | `text.size`, `text.weight` | |
| Line height | `text.lineHeight` | px, or `normal` (about 1.2 × size, depending on the font) |
| Letter spacing | `text.tracking` | px. Figma's `-2%` is `-0.02 × size` px. |
| Text case, alignment, decoration | `text.transform`, `text.align`, `text.decoration` | |
| Text color | `text.color` | `text.contrast` gives the WCAG ratio as well |

**Tolerance:**
- Sizes, positions and spacing: ±0.5 px. bdg rounds to 0.1, and Figma values are often fractional.
- Colors: equal hex after lowercasing.
- Fonts: the same first family, and no fallback shown in `text.rendered`.

**Tokens:**
- Compare the token in `get_design_context` (`var(--color-primary, #0a7cff)`) with the declaration in `rules[]` (`background-color var(--color-primary) = #0a7cff ← .btn-primary (buttons.css:12)`).
- The value can match while the token differs (**right value, wrong token**).
- The declaration can be **hard-coded** where the design uses a token (`#0a7cff` instead of `var(--color-primary)`).
- `--why <property>` shows where the custom property is set and what it overrides.

## 5. Report

Give one row per difference, with the place to fix it:

```text
#buy  padding        design 12 24   page 8 14   .btn (buttons.css:16)
#buy  fills[0]       design #0a7cff page #9db8ff .card .btn (cards.css:18) beats .btn-primary [0,2,0 > 0,1,0]
h2    letter-spacing design -0.48   page 0       no rule: add letter-spacing: -0.03em
.card gap to next    design 24      page 16      main (layout.css:4) margin-bottom
```

The default output (without `--json`) already holds the facts for a quick look:
- `hints` points out declarations that have no effect, such as a `gap` set on a block or a token that isn't defined, which are common reasons a page differs from its design;
- `--why <property>` explains one difference.
