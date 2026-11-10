/**
 * Fixture page for telling forms apart in `dom form` (#881), served by the
 * fixture server: `/form-identify` is the issue's page, a "Partner portal"
 * heading above three forms with ids, different actions and methods and no
 * form-level label (`#save` POST `/loop`, `#export` GET `/export`, `#ok`
 * GET `/done`), plus a fourth form without an id (a search form after the
 * others).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Three forms under one page heading, and an id-less fourth */
const FORM_IDENTIFY_HTML = `<!doctype html><title>form identify</title>
<h1>Partner portal</h1>
<form id="save" action="/loop" method="post"><input name="name" value="Ada"><button>Save</button></form>
<form id="export" action="/export?token=hunter2" method="get"><input name="q" value="all"><button>Export</button></form>
<form id="ok" action="/done" method="get"><input name="x" value="1"><button>Send</button></form>
<div><form action="/find" method="get"><input name="find" value="z"><button>Find</button></form></div>`;

/** Form identification pages by path */
export const ROUTES: FixtureRoutes = {
  '/form-identify': FORM_IDENTIFY_HTML,
};
