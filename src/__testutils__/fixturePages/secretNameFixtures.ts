/**
 * Fixture page for secret field names (#622, #601), served by the fixture
 * server: `/secret-names` has a form (`#account`) with fields named
 * `api_key` (`#apikey`, value APIKEYFIELD7), `token` (`#token`,
 * TOKENFIELD8), `client_secret` (`#secret`, SECRETFIELD9) and `pass`
 * (`#pass`, PASSFIELD10), a hidden `csrf` input (`#csrf`, TOKEN123) and two
 * ordinary fields whose names contain a credential word (`passport`,
 * PASSPORT11; `keyword`, KEYWORD12). On load the page posts
 * `name=ann&pass=HARPASS53&pw=HARPW54&password=FULLPW` (form-urlencoded)
 * and then `{"pass":"JSONPASS55","pw":"JSONPW56"}` to `/secret-names-sink`
 * (which answers `ok`), and adds `#sent` when both have answered. The posted
 * values are joined from parts, so the page's own source, which the HAR
 * holds as a response body, does not contain them. Requests go to `location.origin`, so the
 * page also works when opened as `http://user:pass@host/secret-names`
 * (fetch refuses URLs with credentials).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields named like secrets, a hidden token, and requests sending short password names */
const SECRET_NAMES_HTML = `<!doctype html><title>secret names</title>
<form id="account" onsubmit="event.preventDefault()">
<label for="apikey">Api key</label><input id="apikey" name="api_key" value="APIKEYFIELD7">
<label for="token">Token</label><input id="token" name="token" value="TOKENFIELD8">
<label for="secret">Client secret</label><input id="secret" name="client_secret" value="SECRETFIELD9">
<label for="pass">Pass</label><input id="pass" name="pass" value="PASSFIELD10">
<input type="hidden" id="csrf" name="csrf" value="TOKEN123">
<label for="passport">Passport</label><input id="passport" name="passport" value="PASSPORT11">
<label for="keyword">Keyword</label><input id="keyword" name="keyword" value="KEYWORD12">
<button>Save</button>
</form>
<script>
  const target = location.origin + '/secret-names-sink';
  const joined = (...parts) => parts.join('');
  const post = (type, body) => fetch(target, { method: 'POST', headers: { 'Content-Type': type }, body });
  post(
    'application/x-www-form-urlencoded',
    'name=ann&pass=' + joined('HAR', 'PASS53') + '&pw=' + joined('HAR', 'PW54') + '&password=' + joined('FULL', 'PW')
  )
    .then(() => post('application/json', JSON.stringify({ pass: joined('JSON', 'PASS55'), pw: joined('JSON', 'PW56') })))
    .then(() => {
      const sent = document.createElement('p');
      sent.id = 'sent';
      sent.textContent = 'sent';
      document.body.append(sent);
    });
</script>`;

/** Secret name pages by path */
export const ROUTES: FixtureRoutes = {
  '/secret-names': SECRET_NAMES_HTML,
  '/secret-names-sink': '<!doctype html><p>ok</p>',
};
