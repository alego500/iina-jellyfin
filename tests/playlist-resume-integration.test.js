import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCommonJs } from './helpers/load-commonjs.js';

const itemA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const itemB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ticksPerSecond = 10000000;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Load the real entry point as well as the tracking module: tracker-only tests
// cannot catch a missing markTrackedFileEnded call in the end-file handler.
function setup({ asyncSeek = false } = {}) {
  const events = {};
  const hooks = {};
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  const saved = new Map([
    [itemA, 180.714],
    [itemB, 60],
  ]);
  const stops = [];
  const seeks = [];
  const progress = [];
  let pendingSeek;
  const properties = { 'playlist-pos': 0, 'playlist/0/id': 100, 'playlist/1/id': 101 };
  const status = { position: 0, duration: 3600, paused: false };
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
      osd() {},
      seekTo(position) {
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
                UserData: { PlaybackPositionTicks: saved.get(id) * ticksPerSecond, Played: false },
              },
        };
      },
      async post(url, { data }) {
        if (url.includes('/Progress')) {
          progress.push(data);
          saved.set(data.ItemId, data.PositionTicks / ticksPerSecond);
        }
        if (url.includes('/Stopped')) {
          stops.push(data);
          if (!data.Failed) saved.set(data.ItemId, data.PositionTicks / ticksPerSecond);
        }
        return { statusCode: 204 };
      },
    },
    utils: { resolvePath: (path) => path },
    preferences: { get: (key) => key === 'sync_playback_progress', set() {}, sync() {} },
    mpv: {
      getNumber: (key) => properties[key],
      addHook: (name, priority, callback) => (hooks[priority] = callback),
      getString: (key) => properties[key],
      set: (key, value) => (properties[key] = value),
    },
    sidebar: { loadFile() {}, postMessage() {}, onMessage() {} },
    standaloneWindow: {},
  };
  loadCommonJs('src/index.js', {
    iina,
    ...timers,
    require: (path) => loadCommonJs('src/' + path.slice(2), timers),
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
    progress,
    runResumeSeek,
    async load(id, resume = true) {
      properties['playlist-pos'] = id === itemA ? 0 : 1;
      status.position = 0;
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
    moveCurrentEntry() {
      [properties['playlist/0/id'], properties['playlist/1/id']] = [
        properties['playlist/1/id'],
        properties['playlist/0/id'],
      ];
      properties['playlist-pos'] = 1 - properties['playlist-pos'];
    },
    end({ pauseFirst = false, transition = false, hookAfterPause = false } = {}) {
      if (transition) properties['playlist-pos'] = 1 - properties['playlist-pos'];
      // on_load precedes the reset/pause events on native Next/Previous.
      if (transition && !hookAfterPause && hooks[5]) {
        let continued = false;
        hooks[5](() => (continued = true));
        assert.ok(continued, 'the transition hook must release the load');
      }
      // This is the observed IINA ordering on manual Next/Previous: core has
      // reset before the plugin receives end-file, not a deliberate rewind.
      status.position = 0;
      if (pauseFirst) events['mpv.pause.changed']();
      if (transition && hookAfterPause && hooks[5]) hooks[5](() => {});
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

test('native Next/Previous freezes progress before the reset pause event, not only end-file', async () => {
  const state = setup();
  await state.load(itemA);
  for (const position of [187, 194]) {
    state.sample(position);
    state.end({ transition: true, pauseFirst: true });
    assert.equal(state.saved.get(itemA), position);
    await state.load(itemB);
    state.sample(65);
    state.end({ transition: true, pauseFirst: true });
    assert.equal(state.saved.get(itemB), 65);
    await state.load(itemA);
    assert.equal(state.seeks.at(-1), position);
  }
  assert.equal(state.progress.length, 0, 'reset pause events must not send zero progress');
});

test('tiny positive positions before the resume seek cannot overwrite saved progress', async () => {
  const state = setup();
  await state.load(itemA, false);
  state.pause(0.08);
  for (let n = 0; n < 10; n++) state.sample(1.04);
  assert.equal(state.progress.length, 0);
  state.end();
  assert.equal(state.saved.get(itemA), 180.714);
});

test('a changed playlist entry protects the outgoing position even before the load hook', async () => {
  const state = setup();
  await state.load(itemA);
  state.sample(187);
  state.end({ transition: true, pauseFirst: true, hookAfterPause: true });
  assert.equal(state.saved.get(itemA), 187);
  assert.equal(state.progress.length, 0);
});

test('resume stays protected until the asynchronous seek is observed in player status', async () => {
  const state = setup({ asyncSeek: true });
  await state.load(itemA, false);
  state.runResumeSeek();
  state.pause(1.04);
  for (let n = 0; n < 10; n++) state.sample(1.04);
  assert.equal(state.progress.length, 0, 'calling seekTo is not proof that it has finished');
  state.applySeek();
  state.pause(180.714);
  assert.equal(state.progress.at(-1).PositionTicks, 180.714 * ticksPerSecond);
  state.sample(0);
  state.pause(0);
  assert.equal(state.saved.get(itemA), 0, 'a genuine rewind after resume still works');
});

test('reordering the playing entry does not freeze its progress', async () => {
  const state = setup();
  await state.load(itemA);
  state.sample(187);
  state.moveCurrentEntry();
  state.pause(194);
  assert.equal(state.saved.get(itemA), 194, 'the stable entry ID survives a new playlist index');
});
