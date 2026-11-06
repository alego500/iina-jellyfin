const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');

function setup(title = 'Movie, æøå 🎬') {
  const status = { title };
  const values = { show_playback_title_osd: true, show_notifications: false };
  const messages = [];
  const errors = [];
  const { createPlaybackTitleOsd } = loadModule('src/lib/playback-title-osd.js', {
    setInterval() {
      assert.fail('Title notifications must not start a repeat timer');
    },
    setTimeout() {
      assert.fail('Resume completion must not use a guessed delay');
    },
  });
  const core = { status, osd: (message) => messages.push(message) };
  const manager = createPlaybackTitleOsd({
    core,
    preferences: { get: (key) => values[key] },
    log: (message) => errors.push(message),
  });
  return { manager, core, status, values, messages, errors };
}

test('a ready title is announced once without timers or duplicate metadata messages', () => {
  const state = setup();
  const ready = state.manager.beginFile(true);
  ready();
  ready();
  assert.deepEqual(state.messages, ['Playing: Movie, æøå 🎬']);
});

test('completed resume allows exactly one more title announcement', () => {
  const state = setup();
  const ready = state.manager.beginFile(true);
  state.core.osd('Native seek OSD');
  state.manager.resumeCompleted();
  ready();
  state.manager.resumeCompleted();
  assert.deepEqual(state.messages, [
    'Playing: Movie, æøå 🎬',
    'Native seek OSD',
    'Playing: Movie, æøå 🎬',
  ]);
});

test('metadata arriving after resume produces one usable post-resume message', () => {
  const state = setup('https://host/Videos/id/stream?ApiKey=test-token');
  const ready = state.manager.beginFile(true);
  state.manager.resumeCompleted();
  assert.deepEqual(state.messages, []);
  state.status.title = 'Late title';
  ready();
  ready();
  state.manager.resumeCompleted();
  assert.deepEqual(state.messages, ['Playing: Late title']);
});

test('a stream URL is not echoed while waiting for the initial title', () => {
  const state = setup('https://host/stream');
  const ready = state.manager.beginFile(true);
  assert.deepEqual(state.messages, []);
  state.status.title = 'Ready';
  ready();
  assert.deepEqual(state.messages, ['Playing: Ready']);
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

test('each new load of a repeated item gets its own announcement', () => {
  const state = setup('Repeated movie');
  state.manager.beginFile(true);
  state.manager.beginFile(true);
  assert.deepEqual(state.messages, ['Playing: Repeated movie', 'Playing: Repeated movie']);
});

test('turning off the title toggle suppresses initial and post-resume messages', () => {
  const disabled = setup();
  disabled.values.show_playback_title_osd = false;
  disabled.values.show_notifications = true;
  disabled.manager.beginFile(true)();
  disabled.manager.resumeCompleted();
  assert.deepEqual(disabled.messages, []);

  const state = setup();
  const ready = state.manager.beginFile(true);
  state.values.show_playback_title_osd = false;
  state.manager.resumeCompleted();
  ready();
  assert.equal(state.messages.length, 1);
});

test('loading another file invalidates old metadata callbacks and gives the new file its own messages', () => {
  const state = setup('https://host/stream');
  const oldReady = state.manager.beginFile(true);
  state.status.title = 'Incoming';
  state.manager.beginFile(true);
  oldReady();
  state.manager.resumeCompleted();
  assert.deepEqual(state.messages, ['Playing: Incoming', 'Playing: Incoming']);
});

test('ending a file prevents its pending initial or resume announcement', () => {
  const state = setup('https://host/stream');
  const ready = state.manager.beginFile(true);
  state.manager.invalidate();
  state.status.title = 'Ended';
  state.manager.resumeCompleted();
  ready();
  assert.deepEqual(state.messages, []);
});

test('local files keep their native OSD without extra plugin messages', () => {
  const state = setup('Local movie');
  state.manager.beginFile(false)();
  state.manager.resumeCompleted();
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
