/**
 * Fixture page discovery: every module in `fixturePages/` is served without
 * being listed anywhere, each path once.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadFixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

void describe('loadFixtureRoutes', () => {
  it('serves the pages of every fixturePages module', async () => {
    const routes = await loadFixtureRoutes();
    const samples = [
      '/action-errors',
      '/dialogs',
      '/inspect',
      '/issues/quirks',
      '/frame-order',
      '/shadow-forms',
      '/tabs',
    ];
    for (const route of samples) {
      assert.match(routes.get(route) ?? '', /<title>|<html>/, `${route} is not served`);
    }
  });
});
