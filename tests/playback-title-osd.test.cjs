const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');
const { createPlaybackTitleOsd } = loadModule('src/lib/playback-title-osd.js');

function setup(title = 'Movie, æøå 🎬') {
  const status = { title };
  const values = { show_playback_title_osd: true, show_notifications: false };
  const messages = [];
  const errors = [];
  const core = { status, osd: (message) => messages.push(message) };
  const manager = createPlaybackTitleOsd({
    core,
    preferences: { get: (key) => values[key] },
    log: (message) => errors.push(message),
  });
  return { manager, core, status, values, messages, errors };
}

test('a ready Jellyfin title is announced once independently of subtitle notifications', () => {
  const state = setup();
  const ready = state.manager.beginFile(true);
  ready();
  ready();
  assert.deepEqual(state.messages, ['Playing: Movie, æøå 🎬']);
});

test('a stream URL is never echoed while waiting for its title', () => {
  const state = setup('https://host/Videos/id/stream?ApiKey=test-token');
  const ready = state.manager.beginFile(true);
  assert.deepEqual(state.messages, []);
  state.status.title = 'Resolved movie';
  ready();
  assert.deepEqual(state.messages, ['Playing: Resolved movie']);
});

test('missing titles remain silent until a usable title exists', () => {
  for (const title of ['', '  ', null, undefined]) {
    const state = setup(null);
    state.status.title = title;
    const ready = state.manager.beginFile(true);
    assert.deepEqual(state.messages, []);
    state.status.title = 'Ready';
    ready();
    assert.deepEqual(state.messages, ['Playing: Ready']);
  }
});

test('turning off the title toggle suppresses both ready and delayed announcements', () => {
  const disabled = setup();
  disabled.values.show_playback_title_osd = false;
  disabled.values.show_notifications = true;
  disabled.manager.beginFile(true)();
  assert.deepEqual(disabled.messages, []);

  const delayed = setup('https://host/stream');
  const ready = delayed.manager.beginFile(true);
  delayed.values.show_playback_title_osd = false;
  delayed.status.title = 'Late title';
  ready();
  assert.deepEqual(delayed.messages, []);
});

test('each new load, including a repeated item, gets its own announcement', () => {
  const state = setup('Repeated movie');
  state.manager.beginFile(true);
  state.manager.beginFile(true);
  assert.deepEqual(state.messages, ['Playing: Repeated movie', 'Playing: Repeated movie']);
});

test('ending or replacing a file invalidates its pending announcement', () => {
  const state = setup('https://host/stream');
  const ready = state.manager.beginFile(true);
  state.manager.invalidate();
  state.status.title = 'Incoming title';
  ready();
  assert.deepEqual(state.messages, []);

  const next = state.manager.beginFile(true);
  next();
  ready();
  assert.deepEqual(state.messages, ['Playing: Incoming title']);
});

test('local files invalidate pending Jellyfin callbacks without adding messages', () => {
  const state = setup('https://host/stream');
  const ready = state.manager.beginFile(true);
  state.status.title = 'Local movie';
  state.manager.beginFile(false)();
  ready();
  assert.deepEqual(state.messages, []);
});

test('an unavailable OSD bridge cannot interrupt playback or reject a metadata callback', () => {
  const state = setup();
  state.core.osd = () => {
    throw new Error('window closed');
  };
  let ready;
  assert.doesNotThrow(() => (ready = state.manager.beginFile(true)));
  assert.doesNotThrow(ready);
  assert.equal(state.errors.length, 2);
});
