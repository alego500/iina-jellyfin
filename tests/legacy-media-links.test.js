import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from './helpers/load-commonjs.js';

const { normalizeJellyfinAuthUrl } = loadCommonJs('src/lib/auth-url.js');

test('legacy media links retain encoded tokens, proxy paths, other queries and fragments', () => {
  for (const name of ['api_key', 'api-key', 'x-emby-token']) {
    const url = `https://host/jellyfin/Videos/id/stream?static=true&${name}=one%2Btwo#part`;
    assert.equal(normalizeJellyfinAuthUrl(url), url.replace(`${name}=`, 'ApiKey='));
  }
});

test('legacy media-link normalization leaves explicit modern credentials unchanged', () => {
  const url = 'https://host/Items/id/Download?ApiKey=modern&api_key=old';
  assert.equal(normalizeJellyfinAuthUrl(url), url);
});

test('local files, unrelated web links and absent URLs are not normalized', () => {
  for (const url of [
    undefined,
    null,
    '/tmp/Items/id?api_key=x',
    'https://host/web/#/details?id=x',
    'https://host/movie.mp4?api_key=x',
  ]) {
    assert.equal(normalizeJellyfinAuthUrl(url), url);
  }
});
