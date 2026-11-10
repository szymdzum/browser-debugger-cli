/**
 * Fixture page for telling forms apart in `dom form` (#881), served by the
 * fixture server: `/form-identify` is the issue's page, a "Partner portal"
 * heading above three forms with ids, different actions and methods and no
 * form-level label (`#save` POST `/loop`, `#export` GET `/export`, `#ok`
 * GET `/done`), plus a fourth form without an id (a search form after the
 * others). `/form-identify-shadow` has a light DOM form (`#light`) and two
 * `<x-s>` hosts (`#h1`, `#h2`) with a `<form id="inner">` each in an open
 * shadow root, and `/form-identify-clobber` a form (`#clob`, POST `/go`)
 * with inputs named `id`, `name`, `action` and `method`, which shadow the
 * form's own properties.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Three forms under one page heading, and an id-less fourth */
const FORM_IDENTIFY_HTML = `<!doctype html><title>form identify</title>
<h1>Partner portal</h1>
<form id="save" action="/loop" method="post"><input name="name" value="Ada"><button>Save</button></form>
<form id="export" action="/export?token=hunter2" method="get"><input name="q" value="all"><button>Export</button></form>
<form id="ok" action="/done" method="get"><input name="x" value="1"><button>Send</button></form>
<div><form action="/find" method="get"><input name="find" value="z"><button>Find</button></form></div>`;

/** A light DOM form and two identical forms in shadow roots */
const FORM_IDENTIFY_SHADOW_HTML = `<!doctype html><title>form identify shadow</title>
<form id="light" action="/light" method="get"><input name="l"><button>Go</button></form>
<x-s id="h1"></x-s><x-s id="h2"></x-s>
<script>
  for (const host of document.querySelectorAll('x-s')) {
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<form id="inner" action="/inner" method="get"><input name="s"><button>Go</button></form>';
  }
</script>`;

/** A form whose inputs are named like its own properties */
const FORM_IDENTIFY_CLOBBER_HTML = `<!doctype html><title>form identify clobber</title>
<form id="clob" action="/go" method="post"><input name="id" value="a"><input name="name" value="b"><input name="action" value="c"><input name="method" value="d"><button>Go</button></form>`;

/** Form identification pages by path */
export const ROUTES: FixtureRoutes = {
  '/form-identify': FORM_IDENTIFY_HTML,
  '/form-identify-shadow': FORM_IDENTIFY_SHADOW_HTML,
  '/form-identify-clobber': FORM_IDENTIFY_CLOBBER_HTML,
};
