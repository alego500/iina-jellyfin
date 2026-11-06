const assert = require('node:assert/strict');
const test = require('node:test');
const { loadModule } = require('./helpers.cjs');

const itemA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const itemB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ticksPerSecond = 10000000;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Load the real entry point as well as the tracking module: tracker-only tests
// cannot catch a missing markTrackedFileEnded call in the end-file handler.
function setup({
  asyncSeek = false,
  titleOsd = false,
  played = false,
  seekFails = false,
  showNotifications = false,
} = {}) {
  const events = {};
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  const saved = new Map([
    [itemA, 180.714],
    [itemB, 60],
  ]);
  const stops = [];
  const seeks = [];
  const messages = [];
  const values = {
    sync_playback_progress: true,
    show_playback_title_osd: titleOsd,
    show_notifications: showNotifications,
  };
  let pendingSeek;
  const properties = { 'playlist-pos': 0, 'playlist/0/id': 100, 'playlist/1/id': 101 };
  const status = { position: 0, duration: 3600, paused: false, title: '' };
  const timers = {
    setInterval(callback) {
      intervals.set(++timerId, callback);
      return timerId;
    },
    clearInterval: (id) => intervals.delete(id),
    setTimeout(callback, delay) {
      timeouts.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => timeouts.delete(id),
  };
  const iina = {
    core: {
      status,
      osd: (message) => messages.push(message),
      seekTo(position) {
        if (seekFails) throw new Error('seek failed');
        seeks.push(position);
        pendingSeek = position;
        if (!asyncSeek) status.position = position;
      },
    },
    console,
    menu: { item() {}, addItem() {} },
    event: { on: (name, callback) => (events[name] = callback) },
    http: {
      async get(url) {
        const id = new URL(url).pathname.split('/')[2];
        assert.ok(saved.has(id), 'metadata belongs to a known item');
        return {
          statusCode: 200,
          data: url.includes('/PlaybackInfo')
            ? { PlaySessionId: `session-${id}` }
            : {
                UserData: { PlaybackPositionTicks: saved.get(id) * ticksPerSecond, Played: played },
              },
        };
      },
      async post(url, { data }) {
        if (url.includes('/Stopped')) {
          stops.push(data);
          if (!data.Failed) saved.set(data.ItemId, data.PositionTicks / ticksPerSecond);
        }
        return { statusCode: 204 };
      },
    },
    utils: { resolvePath: (path) => path },
    preferences: { get: (key) => values[key], set() {}, sync() {} },
    mpv: {
      getNumber: (key) => properties[key],
      addHook() {},
      getString: (key) => properties[key],
      set: (key, value) => (properties[key] = value),
    },
    sidebar: { loadFile() {}, postMessage() {}, onMessage() {} },
    standaloneWindow: {},
  };
  loadModule('src/index.js', {
    iina,
    ...timers,
    require: (path) => loadModule('src/' + path.slice(2), timers),
  });

  function runResumeSeek() {
    for (const [id, timer] of [...timeouts]) {
      if (timer.delay === 1000) {
        timeouts.delete(id);
        timer.callback();
      }
    }
    for (const callback of [...intervals.values()]) callback();
  }

  return {
    saved,
    stops,
    seeks,
    messages,
    values,
    playbackRestart: () => events['mpv.playback-restart'](),
    runResumeSeek,
    async load(id, resume = true) {
      properties['playlist-pos'] = id === itemA ? 0 : 1;
      status.position = 0;
      status.title = id === itemA ? 'Movie A' : 'Movie B';
      const url = `https://host/Videos/${id}/stream?ApiKey=test-token`;
      properties['stream-open-filename'] = url;
      events['iina.file-loaded'](url);
      await flush();
      if (resume) {
        runResumeSeek();
      }
    },
    sample(position) {
      status.position = position;
      for (const callback of [...intervals.values()]) callback();
    },
    pause(position) {
      status.position = position;
      status.paused = true;
      events['mpv.pause.changed']();
    },
    applySeek() {
      status.position = pendingSeek;
      for (const callback of [...intervals.values()]) callback();
    },
    changePlayingEntry() {
      properties['playlist-pos'] = 1 - properties['playlist-pos'];
    },
    moveCurrentEntry() {
      [properties['playlist/0/id'], properties['playlist/1/id']] = [
        properties['playlist/1/id'],
        properties['playlist/0/id'],
      ];
      properties['playlist-pos'] = 1 - properties['playlist-pos'];
    },
    end({ pauseFirst = false, transition = false } = {}) {
      if (transition) properties['playlist-pos'] = 1 - properties['playlist-pos'];
      // This is the observed IINA ordering on manual Next/Previous: core has
      // reset before the plugin receives end-file, not a deliberate rewind.
      status.position = 0;
      if (pauseFirst) events['mpv.pause.changed']();
      events['mpv.end-file']();
      if (!pauseFirst) events['mpv.pause.changed']();
      assert.equal(intervals.size, 0, 'the ended file must no longer be sampled');
    },
  };
}

test('repeated playlist Next/Previous preserves each item and resumes the latest position', async () => {
  const state = setup();
  await state.load(itemA);
  assert.equal(state.seeks.at(-1), 180.714);

  for (const position of [187, 194]) {
    state.sample(position);
    state.end();
    await state.load(itemB);
    assert.equal(state.saved.get(itemA), position, 'Next must not erase the outgoing resume point');
    state.sample(65);
    state.end();
    await state.load(itemA);
    assert.equal(state.saved.get(itemB), 65);
    assert.equal(state.seeks.at(-1), position, 'Previous must resume at the position just saved');
  }
  assert.deepEqual(
    state.stops.map(({ ItemId, PositionTicks }) => [ItemId, PositionTicks / ticksPerSecond]),
    [
      [itemA, 187],
      [itemB, 65],
      [itemA, 194],
      [itemB, 65],
    ]
  );
});

test('an intentional rewind sampled before end-file still saves position zero', async () => {
  const state = setup();
  await state.load(itemA);
  state.sample(187);
  state.sample(0);
  state.end();
  assert.equal(state.saved.get(itemA), 0);
  assert.equal(state.stops[0].Failed, false);
});

test('leaving an item before its resume seek preserves the existing saved position', async () => {
  const state = setup();
  await state.load(itemA, false);
  state.end();
  assert.equal(state.saved.get(itemA), 180.714);
  assert.equal(state.stops[0].Failed, false);
});

test('the title is restored once only after the actual asynchronous Jellyfin resume finishes', async () => {
  const state = setup({ asyncSeek: true, titleOsd: true, showNotifications: true });
  await state.load(itemA, false);
  assert.deepEqual(state.messages, ['Playing: Movie A']);
  state.playbackRestart();
  state.runResumeSeek();
  assert.equal(state.seeks.at(-1), 180.714);
  state.playbackRestart();
  assert.equal(
    state.messages.filter((message) => message.startsWith('Playing:')).length,
    1,
    'issuing a seek or a premature playback-restart must not announce completion'
  );

  state.applySeek();
  assert.equal(
    state.messages.filter((message) => message.startsWith('Playing:')).length,
    1,
    'sampling the position alone is not a completed-seek event'
  );
  state.messages.push('Native seek OSD');
  state.pause(179.5); // keyframe rounding within the existing two-second tolerance
  state.playbackRestart();
  assert.equal(state.messages.at(-1), 'Playing: Movie A');
  state.playbackRestart();
  state.sample(500); // a later manual seek must not repeat the title again
  state.playbackRestart();
  assert.equal(state.messages.filter((message) => message.startsWith('Playing:')).length, 2);
});

test('no resume, insignificant saved progress and watched items do not cause a second title', async () => {
  for (const [position, played] of [
    [0, false],
    [14, false],
    [180, true],
  ]) {
    const state = setup({ titleOsd: true, played });
    state.saved.set(itemA, position);
    await state.load(itemA);
    state.playbackRestart();
    state.sample(240); // ordinary manual seek
    state.playbackRestart();
    assert.deepEqual(state.seeks, []);
    assert.deepEqual(state.messages, ['Playing: Movie A']);
  }
});

test('an incoming playlist entry cannot receive the previous item resume title', async () => {
  const state = setup({ asyncSeek: true, titleOsd: true });
  await state.load(itemA, false);
  state.runResumeSeek();
  state.end({ transition: true, pauseFirst: true });
  await state.load(itemB, false);
  state.applySeek(); // completion of the old asynchronous seek
  state.playbackRestart();
  assert.deepEqual(state.messages, ['Playing: Movie A', 'Playing: Movie B']);
});

test('disabling the title toggle before resume completion suppresses the extra message', async () => {
  const state = setup({ asyncSeek: true, titleOsd: true });
  await state.load(itemA, false);
  state.runResumeSeek();
  state.values.show_playback_title_osd = false;
  state.applySeek();
  state.playbackRestart();
  state.values.show_playback_title_osd = true;
  state.playbackRestart();
  assert.deepEqual(state.messages, ['Playing: Movie A']);
});

test('a failed resume seek never arms a second title notification', async () => {
  const state = setup({ titleOsd: true, seekFails: true });
  await state.load(itemA);
  state.sample(180.714);
  state.playbackRestart();
  assert.deepEqual(state.seeks, []);
  assert.deepEqual(state.messages, ['Playing: Movie A']);
});

test('a changed playing entry suppresses resume completion even before end-file arrives', async () => {
  const state = setup({ asyncSeek: true, titleOsd: true });
  await state.load(itemA, false);
  state.runResumeSeek();
  state.applySeek();
  state.changePlayingEntry();
  state.playbackRestart();
  assert.deepEqual(state.messages, ['Playing: Movie A']);
});

test('reordering the same playing entry still allows its resume title', async () => {
  const state = setup({ asyncSeek: true, titleOsd: true });
  await state.load(itemA, false);
  state.runResumeSeek();
  state.moveCurrentEntry();
  state.applySeek();
  state.playbackRestart();
  assert.deepEqual(state.messages, ['Playing: Movie A', 'Playing: Movie A']);
});

test('disabled progress sync does not request a resume or display a second title', async () => {
  const state = setup({ titleOsd: true });
  state.values.sync_playback_progress = false;
  await state.load(itemA);
  state.sample(180.714);
  state.playbackRestart();
  assert.deepEqual(state.seeks, []);
  assert.deepEqual(state.messages, ['Playing: Movie A']);
});
