/**
 * Fixture page for `bdg dom inspect`, served by the fixture server at
 * `/inspect`: a styled button, a flex card with children, a grid list of
 * identical items, a field with a placeholder, an element with a `::before`,
 * a hidden one, a covered one, a webfont (a data: URL copy of a system font,
 * so it loads offline), an element in an open shadow root and one in a
 * same-origin iframe, plus cascade cases (a rule overriding another, flex
 * alignment on a block, an undefined custom property), secrets (a password and a card expiry select that
 * must never be shown), faded text and a block image with no size set (sized by itself).
 */

/** Same-origin iframe content of `/inspect` */
const INSPECT_FRAME_HTML =
  '<!doctype html><button id="in-frame" style="padding:6px 12px;color:#fff;background:#222">Framed</button>';

const INSPECT_HTML = `<!doctype html><meta charset="utf-8"><title>inspect</title>
<style>
  body { margin: 16px; font-family: Arial, sans-serif; color: #111; background: #fff; }
  #buy { padding: 12px 24px; margin: 0 0 16px; border: 1px solid #0a7cff; border-radius: 8px;
    background: #0a7cff; color: #fff; font-size: 16px; line-height: 24px; font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); cursor: pointer; }
  .card { display: flex; flex-direction: column; gap: 16px; width: 280px; padding: 16px;
    border: 1px solid #ddd; border-radius: 6px; }
  .card h3 { margin: 0; font-size: 18px; }
  .card p { margin: 0; }
  #grid { display: grid; grid-template-columns: repeat(3, 100px); gap: 8px; list-style: none; padding: 0; }
  #grid li { height: 40px; background: #eee; }
  #email { padding: 10px 0; border: 0; border-bottom: 1px solid #ededed; }
  #email::placeholder { color: #6d7584; }
  #badge { position: relative; padding-left: 20px; }
  #badge::before { content: "★"; position: absolute; left: 0; color: #f5a623; }
  #ghost { display: none; }
  #under { position: relative; }
  #cover { position: absolute; left: 0; top: 0; width: 200px; height: 40px; background: rgba(0, 0, 0, 0.5); }
  @font-face { font-family: "Fixture Sans"; src: local("Arial"), local("Helvetica"); }
  #webfont { font-family: "Fixture Sans", serif; }
  .tag { color: #c00; padding: 4px 8px; }
  .tag.primary { color: #06c; }
  #hero { display: block; justify-content: center; gap: 12px; }
  #themed { color: var(--brand-color); }
</style>
<button id="buy">Buy now</button>
<div class="card"><h3>Card title</h3><p>Some text</p><a href="#go">Go</a></div>
<ul id="grid">${'<li class="tile"></li>'.repeat(6)}</ul>
<input id="email" placeholder="E-mail">
<p id="badge">Featured</p>
<p id="ghost">Hidden text</p>
<div id="under"><button id="behind">Behind</button><div id="cover"></div></div>
<p id="webfont">Web font text</p>
<div id="host"></div>
<span id="tag" class="tag primary">Tag</span>
<table id="sized" width="120"><tr><td>cell</td></tr></table>
<div id="hero"><span>Hero</span></div>
<p id="themed">Themed</p>
<form id="secrets"><input id="pw" type="password" value="hunter2-secret">
<select id="exp" autocomplete="cc-exp-month"><option>07</option><option selected>11</option></select></form>
<div id="faded" style="opacity:0.4"><p id="faded-text" style="color:#000">Faded text</p></div>
<img id="pic" style="display:block" alt="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<iframe id="frame" src="/inspect-frame" style="width:200px;height:60px;border:0"></iframe>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
    '<span id="shadowed" style="color:#c00;font-weight:700">In shadow</span>';
</script>`;

/** Pages by path */
export const INSPECT_ROUTES: Record<string, string> = {
  '/inspect': INSPECT_HTML,
  '/inspect-frame': INSPECT_FRAME_HTML,
};
