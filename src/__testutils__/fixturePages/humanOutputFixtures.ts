/**
 * Fixture page for human output that must match the data (#645, #585,
 * #734), served by the fixture server: `/human-output` has links to the
 * page's own origin, another origin and a protocol-relative one (the first
 * is set by a script, as the origin is not known beforehand), an input
 * whose placeholder holds a quote, a backslash and a newline, a paragraph
 * whose id holds a quote and a newline, buttons named by `aria-label` (also
 * with quotes), by an SVG `<title>` and a field marked `aria-invalid`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Links, odd values and icon-only buttons */
const HUMAN_OUTPUT_HTML = `<!doctype html><meta charset="utf-8"><title>human output</title>
<a id="same" href="#">Register</a>
<a id="other" href="https://example.com/docs/page">Docs</a>
<a id="rel" href="//proto.example/y">Proto</a>
<input id="odd" placeholder="x">
<p class="odd">odd id</p>
<button class="quote" aria-label='say "hi" (now)'></button>
<button class="menu" aria-label="Open menu"></button>
<button class="svgb"><svg width="8" height="8"><title>SvgTitle</title></svg></button>
<input id="bad" type="email" value="x" required aria-invalid="true">
<script>
document.getElementById('same').setAttribute('href', location.origin + '/register/?a=1#top');
document.getElementById('odd').setAttribute('placeholder', 'say "hi" \\\\ back\\nnext');
document.querySelector('p.odd').id = 'z"b\\nc';
</script>`;

/** Human output pages by path */
export const ROUTES: FixtureRoutes = {
  '/human-output': HUMAN_OUTPUT_HTML,
};
