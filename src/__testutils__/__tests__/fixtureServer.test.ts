/**
 * Fixture server routing: routes match on the pathname, the query is left to
 * the page, and unknown paths are 404 instead of the default page.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { type FixtureServer, startFixtureServer } from '@/__testutils__/fixtureServer.js';

/** Title of the default page served on `/` */
const DEFAULT_TITLE = 'BDG E2E Test Page';

void describe('fixture server routing', () => {
  let fixture: FixtureServer;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await fixture.close();
  });

  /**
   * Fetch a path from the fixture server.
   *
   * @param path - Path with optional query
   * @returns Status and body
   */
  async function get(path: string): Promise<{ status: number; body: string }> {
    const response = await fetch(new URL(path, fixture.url));
    return { status: response.status, body: await response.text() };
  }

  it('serves the default page on /', async () => {
    const { status, body } = await get('/');
    assert.equal(status, 200);
    assert.match(body, new RegExp(DEFAULT_TITLE));
  });

  it('serves a registered page whatever its query', async () => {
    const plain = await get('/shadow-forms');
    const queried = await get('/shadow-forms?x=1');
    assert.doesNotMatch(plain.body, new RegExp(DEFAULT_TITLE));
    assert.equal(queried.status, 200);
    assert.equal(queried.body, plain.body);
    assert.doesNotMatch(queried.body, new RegExp(DEFAULT_TITLE));
  });

  it('serves a built-in route whatever its query', async () => {
    const { status, body } = await get('/forms?x=1');
    assert.equal(status, 200);
    assert.doesNotMatch(body, new RegExp(DEFAULT_TITLE));
  });

  it('answers an unknown path with 404', async () => {
    const { status, body } = await get('/no-such-page');
    assert.equal(status, 404);
    assert.doesNotMatch(body, new RegExp(DEFAULT_TITLE));
  });

  it('keeps recording /beacon queries', async () => {
    const { status } = await get('/beacon?a=1');
    assert.equal(status, 204);
    assert.deepEqual(fixture.beacons, ['a=1']);
  });
});
